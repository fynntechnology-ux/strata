//! STRATA supply crates: commit-reveal randomness.
//!
//! ## Why two transactions
//!
//! A single-transaction "open crate" instruction has no honest source of
//! randomness. Anything the program can read at execution time — the clock,
//! the slot, recent blockhashes — the caller can also read *before* sending,
//! simulate the outcome against, and simply not send when the result is bad.
//! That is not a lottery, it is a free reroll.
//!
//! So opening a crate takes two transactions:
//!
//!   1. **Commit.** The player generates 32 secret bytes locally, sends only
//!      `sha256(secret)`, and pays. The price is spent here, not at reveal,
//!      which is what makes abandoning a bad roll cost the same as taking it.
//!   2. **Reveal.** The player publishes the secret. The program checks it
//!      against the stored hash and mixes it with the hash of the slot
//!      *after* the commit landed — a value that did not exist when the
//!      secret was chosen, and which the player cannot influence or select.
//!
//! Neither party can steer the result: the player cannot predict the slot
//! hash, and no one else can learn the secret.
//!
//! ## The limitation, stated plainly
//!
//! A player who dislikes their outcome can decline to reveal. They forfeit
//! the price, so it is not profitable, but the option exists. A validator
//! producing the commit slot also has some influence over the following
//! slot's hash. Both are why `docs/SECURITY.md` recommends moving to a VRF
//! (ORAO or Switchboard) before real value is ever attached to a crate. This
//! scheme is honest and verifiable; it is not adversarially perfect.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_lang::solana_program::sysvar::slot_hashes;

declare_id!("StrataPacks11111111111111111111111111111111");

pub const PPM: u64 = 1_000_000;
pub const DROP_TABLE_VERSION: u16 = 1;

/// SlotHashes keeps the most recent 512 slots. A reveal must land inside that
/// window or the entropy it was bound to is gone.
pub const REVEAL_WINDOW_SLOTS: u64 = 500;

pub const MAX_EFFECTIVE_LUCK: i16 = 60;

/* ==========================================================================
   Drop tables — must match `src/sim/packs.ts` exactly, in declaration order
   ========================================================================== */

/// [common, uncommon, rare, epic, legendary, mythic], parts per million.
pub const SUPPLY_TABLE: [u32; 6] = [620_000, 280_000, 82_000, 15_000, 2_700, 300];
pub const PROSPECTOR_TABLE: [u32; 6] = [380_000, 400_000, 165_000, 45_000, 9_000, 1_000];
pub const DEEPCORE_TABLE: [u32; 6] = [120_000, 330_000, 350_000, 155_000, 40_000, 5_000];
/// The Deep Core Vault's final draw, guaranteed Rare or better.
pub const DEEPCORE_FINAL_TABLE: [u32; 6] = [0, 0, 620_000, 300_000, 68_000, 12_000];

pub const PACK_PRICES: [u64; 3] = [250, 1_200, 5_000];
pub const PACK_DRAWS: [u8; 3] = [3, 4, 5];

/// Archetype weights per slot, in the declaration order of `ITEM_ARCHETYPES`.
/// Four archetypes per slot, five slots.
pub const ARCHETYPE_WEIGHTS: [[u16; 4]; 5] = [
    [34, 28, 24, 14], // pick
    [34, 27, 25, 14], // drill
    [34, 27, 25, 14], // cell
    [34, 27, 25, 14], // scanner
    [34, 27, 25, 14], // frame
];

#[program]
pub mod strata_packs {
    use super::*;

    /// Step one: pay, and lock in a hash of a secret only the player knows.
    pub fn commit_pack(
        ctx: Context<CommitPack>,
        kind: u8,
        client_seed_hash: [u8; 32],
    ) -> Result<()> {
        require!((kind as usize) < PACK_PRICES.len(), PackError::UnknownPack);

        let clock = Clock::get()?;
        let commit = &mut ctx.accounts.commit;

        commit.owner = ctx.accounts.owner.key();
        commit.kind = kind;
        commit.nonce = ctx.accounts.player_nonce.nonce;
        commit.client_seed_hash = client_seed_hash;
        commit.committed_slot = clock.slot;
        commit.committed_at = clock.unix_timestamp;
        commit.revealed = false;
        commit.bump = ctx.bumps.commit;

        // The nonce advances here so a second commit gets a distinct PDA and
        // the two cannot be confused or replayed against each other.
        ctx.accounts.player_nonce.nonce = ctx
            .accounts
            .player_nonce
            .nonce
            .checked_add(1)
            .ok_or(PackError::NonceOverflow)?;

        // TODO(token): burn `PACK_PRICES[kind]` from the owner's token account
        // here. Charging at commit rather than reveal is deliberate — it is
        // what makes walking away from a bad roll cost the same as taking it.

        emit!(PackCommitted {
            owner: commit.owner,
            kind,
            nonce: commit.nonce,
            committed_slot: commit.committed_slot,
        });

        Ok(())
    }

    /// Step two: publish the secret and mint the contents.
    pub fn reveal_pack(ctx: Context<RevealPack>, client_seed: [u8; 32]) -> Result<()> {
        let commit = &mut ctx.accounts.commit;
        require!(!commit.revealed, PackError::AlreadyRevealed);

        let clock = Clock::get()?;
        // Must be a later slot than the commit, or the "entropy that didn't
        // exist yet" property does not hold.
        require!(clock.slot > commit.committed_slot, PackError::RevealTooEarly);
        require!(
            clock.slot.saturating_sub(commit.committed_slot) <= REVEAL_WINDOW_SLOTS,
            PackError::RevealExpired
        );

        // --- verify the commitment ---------------------------------------
        let recomputed = hash(&client_seed).to_bytes();
        require!(
            recomputed == commit.client_seed_hash,
            PackError::CommitmentMismatch
        );

        // --- fetch entropy bound at commit time --------------------------
        // Specifically the slot *after* the commit. Using "most recent" would
        // let a player wait for a slot hash they like, which is exactly the
        // grinding attack the commit was supposed to prevent.
        let target_slot = commit.committed_slot + 1;
        let slot_hash = read_slot_hash(&ctx.accounts.slot_hashes, target_slot)?;

        // --- derive the roll seed ----------------------------------------
        // sha256(client_seed || slot_hash || owner || nonce_le)
        let mut preimage = Vec::with_capacity(32 + 32 + 32 + 4);
        preimage.extend_from_slice(&client_seed);
        preimage.extend_from_slice(&slot_hash);
        preimage.extend_from_slice(commit.owner.as_ref());
        preimage.extend_from_slice(&commit.nonce.to_le_bytes());
        let reveal_seed = hash(&preimage).to_bytes();

        // --- roll ---------------------------------------------------------
        let luck = ctx.accounts.player_nonce.luck.clamp(0, MAX_EFFECTIVE_LUCK);
        let draws = PACK_DRAWS[commit.kind as usize];
        let mut results: Vec<DrawResult> = Vec::with_capacity(draws as usize);

        for index in 0..draws {
            let is_final = index == draws - 1;
            let table = table_for(commit.kind, is_final);
            let adjusted = apply_luck(table, luck);

            let rarity = weighted_pick(&adjusted, roll_from_seed(&reveal_seed, index as u32 * 64));
            let slot = (roll_from_seed(&reveal_seed, index as u32 * 64 + 1) % 5) as u8;
            let archetype = pick_archetype(slot, roll_from_seed(&reveal_seed, index as u32 * 64 + 2));
            // Quality is the position of the roll inside the stat range, in
            // basis points, so the client can reproduce every stat exactly.
            let quality =
                (roll_from_seed(&reveal_seed, index as u32 * 64 + 16) % 10_001) as u16;

            results.push(DrawResult {
                rarity,
                slot,
                archetype,
                quality,
            });
        }

        commit.revealed = true;

        // TODO(mint): each `DrawResult` becomes a compressed NFT via a
        // Bubblegum CPI, with the stats derived from `reveal_seed` and the
        // shared archetype table. Until then the event *is* the record, and
        // it carries everything needed to recompute the roll.
        emit!(PackRevealed {
            owner: commit.owner,
            kind: commit.kind,
            nonce: commit.nonce,
            reveal_seed,
            slot_hash,
            drop_table_version: DROP_TABLE_VERSION,
            results,
        });

        Ok(())
    }
}

/* ==========================================================================
   Randomness helpers — byte-for-byte twins of `src/lib/rng.ts`
   ========================================================================== */

/// `u64::from_be_bytes(sha256(seed || index_le)[0..8])`
pub fn roll_from_seed(seed: &[u8; 32], index: u32) -> u64 {
    let mut preimage = Vec::with_capacity(36);
    preimage.extend_from_slice(seed);
    preimage.extend_from_slice(&index.to_le_bytes());
    let digest = hash(&preimage).to_bytes();
    u64::from_be_bytes(digest[0..8].try_into().unwrap())
}

/// Walks cumulative weights in declaration order. The order is part of the
/// spec: reordering a table changes historical outcomes.
pub fn weighted_pick(table: &[u32; 6], roll: u64) -> u8 {
    let target = (roll % PPM) as u32;
    let mut cumulative: u32 = 0;
    for (index, weight) in table.iter().enumerate() {
        cumulative = cumulative.saturating_add(*weight);
        if target < cumulative {
            return index as u8;
        }
    }
    5
}

pub fn table_for(kind: u8, is_final: bool) -> &'static [u32; 6] {
    match (kind, is_final) {
        (2, true) => &DEEPCORE_FINAL_TABLE,
        (0, _) => &SUPPLY_TABLE,
        (1, _) => &PROSPECTOR_TABLE,
        _ => &DEEPCORE_TABLE,
    }
}

/// Shifts weight out of Common into everything above it, proportional to tier.
/// Truncation drift is returned to Common so the table always sums to exactly
/// `PPM` — an under-sum would silently bias the final bucket.
pub fn apply_luck(table: &[u32; 6], luck: i16) -> [u32; 6] {
    let luck = luck.clamp(0, MAX_EFFECTIVE_LUCK) as u64;
    if luck == 0 {
        return *table;
    }

    let common = table[0] as u64;
    let budget = common * luck / 200;
    let weight_sum: u64 = (1..6).sum();

    let mut out = *table;
    let mut distributed = 0u64;

    for tier in 1..6usize {
        let share = budget * tier as u64 / weight_sum;
        distributed += share;
        out[tier] = out[tier].saturating_add(share as u32);
    }

    out[0] = (common - distributed) as u32;

    let total: u32 = out.iter().sum();
    if total < PPM as u32 {
        out[0] += PPM as u32 - total;
    }

    out
}

pub fn pick_archetype(slot: u8, roll: u64) -> u8 {
    let weights = &ARCHETYPE_WEIGHTS[slot as usize];
    let total: u64 = weights.iter().map(|w| *w as u64).sum();
    let mut target = roll % total;

    for (index, weight) in weights.iter().enumerate() {
        let w = *weight as u64;
        if target < w {
            return index as u8;
        }
        target -= w;
    }
    (weights.len() - 1) as u8
}

/// Reads one entry out of the SlotHashes sysvar.
///
/// SlotHashes is far too large to deserialize with the usual Anchor helpers,
/// so the layout is walked by hand: an 8-byte little-endian entry count,
/// followed by `(u64 slot, [u8; 32] hash)` pairs, newest first.
pub fn read_slot_hash(account: &AccountInfo, wanted_slot: u64) -> Result<[u8; 32]> {
    require!(
        account.key() == slot_hashes::ID,
        PackError::InvalidSlotHashesAccount
    );

    let data = account.try_borrow_data()?;
    require!(data.len() >= 8, PackError::SlotHashUnavailable);

    let count = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
    const ENTRY: usize = 40; // 8-byte slot + 32-byte hash

    for index in 0..count {
        let offset = 8 + index * ENTRY;
        if offset + ENTRY > data.len() {
            break;
        }
        let slot = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        if slot == wanted_slot {
            let mut out = [0u8; 32];
            out.copy_from_slice(&data[offset + 8..offset + ENTRY]);
            return Ok(out);
        }
    }

    // The bound slot has aged out. Failing is correct: substituting a
    // different slot's hash would hand the player exactly the grinding
    // opportunity the commit was designed to remove.
    Err(PackError::SlotHashUnavailable.into())
}

/* ==========================================================================
   Accounts
   ========================================================================== */

#[account]
pub struct PackCommit {
    pub owner: Pubkey,
    pub kind: u8,
    pub nonce: u32,
    pub client_seed_hash: [u8; 32],
    pub committed_slot: u64,
    pub committed_at: i64,
    pub revealed: bool,
    pub bump: u8,
}

impl PackCommit {
    pub const SPACE: usize = 8 + 32 + 1 + 4 + 32 + 8 + 8 + 1 + 1;
}

/// Minimal per-player state this program owns: the commit nonce and a cached
/// luck value. Kept separate from the core `Player` account so the two
/// programs can be upgraded independently.
#[account]
pub struct PlayerPackState {
    pub owner: Pubkey,
    pub nonce: u32,
    pub luck: i16,
    pub bump: u8,
}

impl PlayerPackState {
    pub const SPACE: usize = 8 + 32 + 4 + 2 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct DrawResult {
    pub rarity: u8,
    pub slot: u8,
    pub archetype: u8,
    /// Roll position within the stat range, in ten-thousandths.
    pub quality: u16,
}

#[derive(Accounts)]
pub struct CommitPack<'info> {
    #[account(
        init,
        payer = owner,
        space = PackCommit::SPACE,
        seeds = [b"commit", owner.key().as_ref(), &player_nonce.nonce.to_le_bytes()],
        bump
    )]
    pub commit: Account<'info, PackCommit>,

    #[account(
        mut,
        seeds = [b"pack-state", owner.key().as_ref()],
        bump = player_nonce.bump,
        has_one = owner @ PackError::Unauthorized
    )]
    pub player_nonce: Account<'info, PlayerPackState>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealPack<'info> {
    #[account(
        mut,
        seeds = [b"commit", owner.key().as_ref(), &commit.nonce.to_le_bytes()],
        bump = commit.bump,
        has_one = owner @ PackError::Unauthorized
    )]
    pub commit: Account<'info, PackCommit>,

    #[account(
        seeds = [b"pack-state", owner.key().as_ref()],
        bump = player_nonce.bump
    )]
    pub player_nonce: Account<'info, PlayerPackState>,

    pub owner: Signer<'info>,

    /// CHECK: verified against the SlotHashes sysvar id inside `read_slot_hash`.
    #[account(address = slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

/* ==========================================================================
   Events
   ========================================================================== */

#[event]
pub struct PackCommitted {
    pub owner: Pubkey,
    pub kind: u8,
    pub nonce: u32,
    pub committed_slot: u64,
}

/// Everything needed to recompute the roll independently. This is what makes
/// "published odds" a checkable claim rather than a marketing line.
#[event]
pub struct PackRevealed {
    pub owner: Pubkey,
    pub kind: u8,
    pub nonce: u32,
    pub reveal_seed: [u8; 32],
    pub slot_hash: [u8; 32],
    pub drop_table_version: u16,
    pub results: Vec<DrawResult>,
}

/* ==========================================================================
   Errors
   ========================================================================== */

#[error_code]
pub enum PackError {
    #[msg("Unknown crate type")]
    UnknownPack,
    #[msg("Only the owner may do that")]
    Unauthorized,
    #[msg("This crate has already been revealed")]
    AlreadyRevealed,
    #[msg("Reveal must happen in a later slot than the commit")]
    RevealTooEarly,
    #[msg("Reveal window has closed — the bound slot hash has aged out")]
    RevealExpired,
    #[msg("The revealed seed does not match the committed hash")]
    CommitmentMismatch,
    #[msg("Slot hash for the committed slot is no longer available")]
    SlotHashUnavailable,
    #[msg("Not the SlotHashes sysvar")]
    InvalidSlotHashesAccount,
    #[msg("Commit nonce overflowed")]
    NonceOverflow,
}

/* ==========================================================================
   Tests
   ========================================================================== */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drop_tables_sum_to_one_million() {
        for table in [
            &SUPPLY_TABLE,
            &PROSPECTOR_TABLE,
            &DEEPCORE_TABLE,
            &DEEPCORE_FINAL_TABLE,
        ] {
            let total: u64 = table.iter().map(|w| *w as u64).sum();
            assert_eq!(total, PPM, "drop table must sum to exactly 1_000_000 ppm");
        }
    }

    #[test]
    fn luck_preserves_the_total() {
        for luck in 0..=MAX_EFFECTIVE_LUCK {
            for table in [&SUPPLY_TABLE, &PROSPECTOR_TABLE, &DEEPCORE_TABLE] {
                let adjusted = apply_luck(table, luck);
                let total: u64 = adjusted.iter().map(|w| *w as u64).sum();
                assert_eq!(total, PPM, "luck {luck} broke the table total");
            }
        }
    }

    #[test]
    fn deepcore_final_draw_cannot_roll_below_rare() {
        for roll in (0..PPM).step_by(997) {
            let rarity = weighted_pick(&DEEPCORE_FINAL_TABLE, roll);
            assert!(rarity >= 2, "final draw rolled below Rare");
        }
    }
}
