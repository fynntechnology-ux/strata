//! STRATA marketplace: escrowed listings, direct buys and offers.
//!
//! The design goal is that neither side of a trade ever has to trust the
//! other, and that no operator sits in the middle able to freeze or take a
//! trade. That means:
//!
//!   * **Listed items are escrowed.** The item moves into a PDA-owned vault
//!     at list time. A seller cannot list something and then sell or equip it
//!     elsewhere, and a buyer's payment is never at risk of arriving after the
//!     item has gone.
//!   * **Settlement is atomic.** Payment out, item in, fee split, listing
//!     closed — one instruction. There is no state where the buyer has paid
//!     and does not own the item.
//!   * **The buyer states the price they agreed to.** `max_price` is checked
//!     against the listing. If a seller edits the price between the buyer
//!     reading the page and the transaction landing, the buy fails instead of
//!     quietly charging more.
//!
//! The escrow pattern here follows the well-known Anchor escrow shape
//! (a PDA as vault authority); see CREDITS.md.

use anchor_lang::prelude::*;

declare_id!("StrataMarket1111111111111111111111111111111");

pub const MAX_FEE_BPS: u16 = 1_000;
/// Offers expire so the order book cannot fill with stale commitments.
pub const MAX_OFFER_TTL_SECS: i64 = 30 * 86_400;

#[program]
pub mod strata_market {
    use super::*;

    /// Lists an item, moving it into escrow.
    pub fn list_item(ctx: Context<ListItem>, price: u64) -> Result<()> {
        require!(price > 0, MarketError::InvalidPrice);
        require!(!ctx.accounts.config.paused, MarketError::Paused);

        let clock = Clock::get()?;
        let listing = &mut ctx.accounts.listing;

        listing.seller = ctx.accounts.seller.key();
        listing.item_mint = ctx.accounts.item_mint.key();
        listing.price = price;
        listing.created_at = clock.unix_timestamp;
        listing.expires_at = 0; // 0 = no expiry
        listing.active = true;
        listing.bump = ctx.bumps.listing;

        // TODO(token): transfer 1 unit of `item_mint` from the seller's token
        // account into `vault`, whose authority is the listing PDA. For
        // compressed NFTs this becomes a Bubblegum `transfer` CPI with the
        // listing PDA as the new leaf owner.

        emit!(ListingCreated {
            listing: listing.key(),
            seller: listing.seller,
            item_mint: listing.item_mint,
            price,
            at: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Cancels a listing and returns the item.
    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        require!(listing.active, MarketError::ListingInactive);

        listing.active = false;

        // TODO(token): transfer the escrowed item back to the seller and
        // close the vault, refunding its rent to the seller.

        emit!(ListingCancelled {
            listing: listing.key(),
            seller: listing.seller,
        });

        Ok(())
    }

    /// Buys a listing outright.
    ///
    /// `max_price` is the price the buyer actually saw and agreed to. It is
    /// not a slippage tolerance — it is an exact upper bound, because there is
    /// no legitimate reason for a fixed-price listing to cost more than the
    /// number displayed when the buyer clicked.
    pub fn buy_listing(ctx: Context<BuyListing>, max_price: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::Paused);

        let listing = &mut ctx.accounts.listing;
        require!(listing.active, MarketError::ListingInactive);
        require!(
            listing.seller != ctx.accounts.buyer.key(),
            MarketError::SelfPurchase
        );
        require!(listing.price <= max_price, MarketError::PriceMoved);

        if listing.expires_at != 0 {
            require!(
                Clock::get()?.unix_timestamp < listing.expires_at,
                MarketError::ListingExpired
            );
        }

        let split = fee_split(
            listing.price,
            ctx.accounts.config.market_fee_bps,
            ctx.accounts.config.burn_share_bps,
        )?;

        listing.active = false;

        // TODO(token): three transfers, all in this one instruction so the
        // trade is atomic:
        //   1. buyer -> seller           : split.to_seller
        //   2. buyer -> treasury         : split.to_treasury
        //   3. burn                      : split.to_burn
        //   4. vault  -> buyer           : the escrowed item
        // The vault signs with the listing PDA seeds.

        emit!(ListingSold {
            listing: listing.key(),
            seller: listing.seller,
            buyer: ctx.accounts.buyer.key(),
            price: listing.price,
            fee: split.fee,
            burned: split.to_burn,
        });

        Ok(())
    }

    /// Places a bid below the asking price.
    pub fn make_offer(ctx: Context<MakeOffer>, amount: u64, expires_at: i64) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::Paused);
        require!(amount > 0, MarketError::InvalidPrice);

        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now, MarketError::OfferExpiryInPast);
        require!(
            expires_at - now <= MAX_OFFER_TTL_SECS,
            MarketError::OfferTtlTooLong
        );
        require!(ctx.accounts.listing.active, MarketError::ListingInactive);

        let offer = &mut ctx.accounts.offer;
        offer.listing = ctx.accounts.listing.key();
        offer.buyer = ctx.accounts.buyer.key();
        offer.amount = amount;
        offer.created_at = now;
        offer.expires_at = expires_at;
        offer.bump = ctx.bumps.offer;

        // TODO(token): move `amount` into the offer's own escrow account. An
        // offer backed by a balance the bidder can spend elsewhere is not an
        // offer, it is a suggestion — and accepting one would fail at random.

        emit!(OfferMade {
            listing: offer.listing,
            buyer: offer.buyer,
            amount,
            expires_at,
        });

        Ok(())
    }

    /// Accepts an offer, settling at the offered price.
    pub fn accept_offer(ctx: Context<AcceptOffer>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        let offer = &ctx.accounts.offer;
        require!(offer.expires_at > now, MarketError::OfferExpired);

        let listing = &mut ctx.accounts.listing;
        require!(listing.active, MarketError::ListingInactive);

        let split = fee_split(
            offer.amount,
            ctx.accounts.config.market_fee_bps,
            ctx.accounts.config.burn_share_bps,
        )?;

        listing.active = false;

        // TODO(token): release the offer escrow to the seller net of fees,
        // send the escrowed item to the bidder, and close both accounts.

        emit!(ListingSold {
            listing: listing.key(),
            seller: listing.seller,
            buyer: offer.buyer,
            price: offer.amount,
            fee: split.fee,
            burned: split.to_burn,
        });

        Ok(())
    }

    /// Reclaims escrow from an offer that was never accepted.
    pub fn cancel_offer(ctx: Context<CancelOffer>) -> Result<()> {
        // TODO(token): return the escrowed amount to the bidder.
        emit!(OfferCancelled {
            listing: ctx.accounts.offer.listing,
            buyer: ctx.accounts.offer.buyer,
        });
        Ok(())
    }
}

/* ==========================================================================
   Fees
   ========================================================================== */

pub struct FeeSplit {
    pub fee: u64,
    pub to_seller: u64,
    pub to_treasury: u64,
    pub to_burn: u64,
}

/// Integer split that always reconciles: `to_seller + fee == price`, and
/// `to_treasury + to_burn == fee`. Rounding remainders go to the treasury, not
/// into thin air — a split that loses a lamport per trade is a slow leak.
pub fn fee_split(price: u64, fee_bps: u16, burn_share_bps: u16) -> Result<FeeSplit> {
    require!(fee_bps <= MAX_FEE_BPS, MarketError::FeeTooHigh);
    require!(burn_share_bps <= 10_000, MarketError::InvalidParameter);

    let fee = price
        .checked_mul(fee_bps as u64)
        .ok_or(MarketError::MathOverflow)?
        / 10_000;
    let to_burn = fee
        .checked_mul(burn_share_bps as u64)
        .ok_or(MarketError::MathOverflow)?
        / 10_000;

    Ok(FeeSplit {
        fee,
        to_seller: price - fee,
        to_treasury: fee - to_burn,
        to_burn,
    })
}

/* ==========================================================================
   Accounts
   ========================================================================== */

/// Read-only mirror of the core program's config. Duplicated as a local
/// account type rather than a cross-program import so the two can be built
/// and upgraded independently.
#[account]
pub struct MarketConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub market_fee_bps: u16,
    pub burn_share_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

#[account]
pub struct Listing {
    pub seller: Pubkey,
    pub item_mint: Pubkey,
    pub price: u64,
    pub created_at: i64,
    /// 0 means no expiry.
    pub expires_at: i64,
    pub active: bool,
    pub bump: u8,
}

impl Listing {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct Offer {
    pub listing: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}

impl Offer {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1;
}

#[derive(Accounts)]
pub struct ListItem<'info> {
    #[account(
        init,
        payer = seller,
        space = Listing::SPACE,
        seeds = [b"listing", seller.key().as_ref(), item_mint.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: escrow authority is the listing PDA; contents handled by CPI.
    #[account(
        mut,
        seeds = [b"vault", listing.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    /// CHECK: identifies the item; validated by the token CPI when wired up.
    pub item_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub seller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(
        mut,
        seeds = [b"listing", seller.key().as_ref(), listing.item_mint.as_ref()],
        bump = listing.bump,
        has_one = seller @ MarketError::Unauthorized
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: PDA vault; authority is the listing.
    #[account(mut, seeds = [b"vault", listing.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub seller: Signer<'info>,
}

#[derive(Accounts)]
pub struct BuyListing<'info> {
    #[account(
        mut,
        seeds = [b"listing", listing.seller.as_ref(), listing.item_mint.as_ref()],
        bump = listing.bump
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: PDA vault holding the escrowed item.
    #[account(mut, seeds = [b"vault", listing.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    /// CHECK: paid out by the token CPI; identity pinned by the listing.
    #[account(mut, address = listing.seller @ MarketError::SellerMismatch)]
    pub seller: UncheckedAccount<'info>,

    /// CHECK: fee destination, pinned to config.
    #[account(mut, address = config.treasury @ MarketError::TreasuryMismatch)]
    pub treasury: UncheckedAccount<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MakeOffer<'info> {
    #[account(
        init,
        payer = buyer,
        space = Offer::SPACE,
        seeds = [b"offer", listing.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub offer: Account<'info, Offer>,

    pub listing: Account<'info, Listing>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    #[account(
        mut,
        close = buyer,
        seeds = [b"offer", listing.key().as_ref(), buyer.key().as_ref()],
        bump = offer.bump
    )]
    pub offer: Account<'info, Offer>,

    #[account(
        mut,
        seeds = [b"listing", seller.key().as_ref(), listing.item_mint.as_ref()],
        bump = listing.bump,
        has_one = seller @ MarketError::Unauthorized
    )]
    pub listing: Account<'info, Listing>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    /// CHECK: rent from the closed offer account returns here.
    #[account(mut, address = offer.buyer @ MarketError::BuyerMismatch)]
    pub buyer: UncheckedAccount<'info>,

    #[account(mut)]
    pub seller: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelOffer<'info> {
    #[account(
        mut,
        close = buyer,
        seeds = [b"offer", offer.listing.as_ref(), buyer.key().as_ref()],
        bump = offer.bump,
        has_one = buyer @ MarketError::Unauthorized
    )]
    pub offer: Account<'info, Offer>,

    #[account(mut)]
    pub buyer: Signer<'info>,
}

/* ==========================================================================
   Events
   ========================================================================== */

#[event]
pub struct ListingCreated {
    pub listing: Pubkey,
    pub seller: Pubkey,
    pub item_mint: Pubkey,
    pub price: u64,
    pub at: i64,
}

#[event]
pub struct ListingCancelled {
    pub listing: Pubkey,
    pub seller: Pubkey,
}

#[event]
pub struct ListingSold {
    pub listing: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price: u64,
    pub fee: u64,
    pub burned: u64,
}

#[event]
pub struct OfferMade {
    pub listing: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub expires_at: i64,
}

#[event]
pub struct OfferCancelled {
    pub listing: Pubkey,
    pub buyer: Pubkey,
}

/* ==========================================================================
   Errors
   ========================================================================== */

#[error_code]
pub enum MarketError {
    #[msg("The marketplace is paused")]
    Paused,
    #[msg("Only the owner may do that")]
    Unauthorized,
    #[msg("Price must be above zero")]
    InvalidPrice,
    #[msg("Marketplace fee cannot exceed 10%")]
    FeeTooHigh,
    #[msg("Invalid parameter")]
    InvalidParameter,
    #[msg("This listing is no longer active")]
    ListingInactive,
    #[msg("This listing has expired")]
    ListingExpired,
    #[msg("You cannot buy your own listing")]
    SelfPurchase,
    #[msg("The price changed since you saw it")]
    PriceMoved,
    #[msg("Offer expiry must be in the future")]
    OfferExpiryInPast,
    #[msg("Offer expiry is too far out")]
    OfferTtlTooLong,
    #[msg("This offer has expired")]
    OfferExpired,
    #[msg("Seller account does not match the listing")]
    SellerMismatch,
    #[msg("Buyer account does not match the offer")]
    BuyerMismatch,
    #[msg("Treasury account does not match config")]
    TreasuryMismatch,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_split_always_reconciles() {
        for price in [1u64, 7, 99, 1_234, 1_000_000, u64::MAX / 20_000] {
            let split = fee_split(price, 250, 4_000).unwrap();
            assert_eq!(split.to_seller + split.fee, price);
            assert_eq!(split.to_treasury + split.to_burn, split.fee);
        }
    }

    #[test]
    fn fee_split_rejects_an_excessive_fee() {
        assert!(fee_split(1_000, MAX_FEE_BPS + 1, 0).is_err());
    }
}
