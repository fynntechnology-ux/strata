//! STRATA core program: config, claims, mining settlement and the city.
//!
//! This program is the authority on what a player owns. Its job is not to
//! simulate the game — the client does that, and does it sixty times a second
//! — but to *bound* what the client is allowed to claim.
//!
//! The central idea, and the reason this is worth writing at all:
//!
//!   Energy is a pure function of elapsed time. The program can compute, from
//!   nothing but a stored timestamp and the clock, the maximum energy that
//!   could possibly have accrued. Yield per unit of energy is likewise capped
//!   by equipment the program can see. So a player running a patched client
//!   can choose *which* resources to claim, but not *how much*.
//!
//! That turns the hardest problem in a browser game — an untrusted client —
//! into a bounded one, without putting a voxel engine on-chain.
//!
//! Every constant here has a twin in `src/sim/`. Where a number appears in
//! both, the TypeScript is the reference implementation and this must match
//! it exactly; `economy.test.ts` pins the TypeScript side.

use anchor_lang::prelude::*;

declare_id!("Strata111111111111111111111111111111111111");

/* ==========================================================================
   Constants — mirrors of `src/sim/economy.ts` and `src/sim/buildings.ts`
   ========================================================================== */

/// Energy is stored in hundredths so the whole program stays integer-only.
/// Floats are not deterministic across BPF and x86, and a rounding difference
/// between client and program means a rejected transaction the player cannot
/// explain.
pub const ENERGY_SCALE: u64 = 100;

pub const BASE_ENERGY_MAX: u64 = 100 * ENERGY_SCALE;
pub const BASE_ENERGY_REGEN_PER_SEC: u64 = 240; // 2.40/s in hundredths
pub const BASE_STORAGE: u64 = 3_000;
pub const BASE_WORKERS: u16 = 4;
pub const BASE_MARKET_FEE_BPS: u16 = 250;

/// Energy to break the softest block (hardness 0.5), in hundredths.
/// `miningEnergyCost(0.5, base)` = 1.15 * 0.5 = 0.575 -> 57.
pub const MIN_BLOCK_ENERGY: u64 = 57;

/// Slack on the energy bound, in hundredths.
///
/// Clock skew between the client's projection and `Clock::get()` is real and
/// unavoidable. Without a small tolerance, honest players lose batches at the
/// boundary; with too much, it becomes a free allowance. One block's worth is
/// the right size: enough to absorb jitter, too little to farm.
pub const ENERGY_TOLERANCE: u64 = MIN_BLOCK_ENERGY;

pub const RESOURCE_COUNT: usize = 13;
pub const MAX_BUILDINGS: usize = 32;

/// Sink prices per resource, indexed by the discriminants in `sim/types.ts`.
/// coal, iron, copper, silver, titanium, crystal, voidstone,
/// ironIngot, copperIngot, silverIngot, titaniumPlate, focusedCrystal, voidCore
pub const RESOURCE_VALUES: [u64; RESOURCE_COUNT] =
    [1, 3, 4, 9, 22, 55, 140, 38, 50, 112, 265, 650, 1650];

#[program]
pub mod strata_core {
    use super::*;

    /* ----------------------------------------------------------------- */

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        market_fee_bps: u16,
        burn_share_bps: u16,
    ) -> Result<()> {
        require!(market_fee_bps <= 1_000, StrataError::FeeTooHigh);
        require!(burn_share_bps <= 10_000, StrataError::InvalidParameter);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.treasury = ctx.accounts.treasury.key();
        config.token_mint = None;
        config.market_fee_bps = market_fee_bps;
        config.burn_share_bps = burn_share_bps;
        config.drop_table_version = 1;
        config.paused = false;
        config.bump = ctx.bumps.config;

        Ok(())
    }

    /// Sets the SPL mint once a token exists.
    ///
    /// Separate from `initialize_config` on purpose: the game is deployable
    /// and playable with `token_mint: None`, and nothing about the design
    /// requires a token to exist before the game is worth playing.
    pub fn set_token_mint(ctx: Context<AdminOnly>, mint: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.token_mint.is_none(), StrataError::MintAlreadySet);
        config.token_mint = Some(mint);
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /* ----------------------------------------------------------------- */

    /// Registers a claim. The seed is derived from the owner's pubkey, so the
    /// terrain is reproducible by anyone holding only the address.
    pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let owner = ctx.accounts.owner.key();

        let player = &mut ctx.accounts.player;
        player.owner = owner;
        player.claim_seed = derive_claim_seed(&owner);
        player.created_at = now;
        player.last_settled_at = now;
        player.xp = 0;
        player.total_mined = 0;
        player.packs_opened = 0;
        player.energy_value = BASE_ENERGY_MAX;
        player.energy_at = now;
        player.resources = [0; RESOURCE_COUNT];
        player.buildings = Vec::new();
        player.equipped_stats = EquippedStats::default();
        player.next_commit_nonce = 0;
        player.bump = ctx.bumps.player;

        emit!(PlayerInitialized {
            owner,
            claim_seed: player.claim_seed,
            at: now,
        });

        Ok(())
    }

    /// Commits a batch of hand-mined resources.
    ///
    /// The two `require!`s below are the entire anti-cheat story. Everything
    /// else in this program is bookkeeping.
    pub fn settle_mining(
        ctx: Context<UpdatePlayer>,
        entries: Vec<ResourceEntry>,
        energy_spent: u32,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, StrataError::Paused);
        require!(!entries.is_empty(), StrataError::EmptyBatch);
        require!(entries.len() <= RESOURCE_COUNT, StrataError::InvalidParameter);

        let now = Clock::get()?.unix_timestamp;
        let player = &mut ctx.accounts.player;
        let spent = energy_spent as u64;

        // --- bound 1: you cannot spend energy you could not have had -----
        let available = player.current_energy(now);
        require!(
            spent <= available.saturating_add(ENERGY_TOLERANCE),
            StrataError::EnergyOverclaim
        );

        // --- bound 2: energy buys a limited number of blocks -------------
        // The softest block in the game costs `MIN_BLOCK_ENERGY`, so this is
        // the most generous possible reading of how the energy was spent.
        let max_blocks = spent / MIN_BLOCK_ENERGY;
        let yield_bonus = player.equipped_stats.yield_bonus.max(0) as u64;
        let max_units = max_blocks
            .saturating_mul(100u64.saturating_add(yield_bonus))
            .saturating_div(100)
            .saturating_add(4); // rounding slack, matches the client

        let claimed: u64 = entries.iter().map(|e| e.amount as u64).sum();
        require!(claimed <= max_units, StrataError::YieldOverclaim);

        // --- apply --------------------------------------------------------
        let capacity = player.storage_capacity();
        let mut held = player.total_resources();
        let mut granted = 0u64;

        for entry in entries.iter() {
            require!(
                (entry.kind as usize) < RESOURCE_COUNT,
                StrataError::UnknownResource
            );
            let headroom = capacity.saturating_sub(held);
            if headroom == 0 {
                break;
            }
            let take = (entry.amount as u64).min(headroom);
            let slot = &mut player.resources[entry.kind as usize];
            *slot = slot.saturating_add(take as u32);
            held = held.saturating_add(take);
            granted = granted.saturating_add(take);
        }

        player.energy_value = available.saturating_sub(spent);
        player.energy_at = now;
        player.total_mined = player.total_mined.saturating_add(granted);
        player.xp = player.xp.saturating_add(granted.max(1) / 2);

        emit!(MiningSettled {
            owner: player.owner,
            granted,
            energy_spent: spent,
            at: now,
        });

        Ok(())
    }

    /// Settles passive city output.
    ///
    /// The client sends nothing here beyond the instruction itself — the
    /// program derives the whole result from elapsed slots and the buildings
    /// it already stores. There is nothing for a modified client to inflate.
    pub fn claim_yield(ctx: Context<UpdatePlayer>) -> Result<()> {
        require!(!ctx.accounts.config.paused, StrataError::Paused);

        let now = Clock::get()?.unix_timestamp;
        let player = &mut ctx.accounts.player;

        let elapsed = now.saturating_sub(player.last_settled_at).max(0) as u64;
        require!(elapsed > 0, StrataError::NothingAccrued);

        // Cap the settled window. A claim left for a year should not mint a
        // year of output in one transaction; offline progress is a courtesy,
        // not an entitlement, and an uncapped window is an inflation bug.
        let window = elapsed.min(7 * 86_400);

        let produced = player.simulate_extractors(window);
        require!(produced > 0, StrataError::NothingAccrued);

        player.last_settled_at = now;
        player.xp = player.xp.saturating_add(produced / 4);

        emit!(YieldClaimed {
            owner: player.owner,
            produced,
            window,
            at: now,
        });

        Ok(())
    }

    /// Sells resources to the sink at posted rates.
    ///
    /// Minting the proceeds is a CPI to the SPL token program once a mint
    /// exists. Until then the program tracks a balance on the player account,
    /// which is exactly what the simulated adapter does client-side.
    pub fn sell_resources(ctx: Context<UpdatePlayer>, entries: Vec<ResourceEntry>) -> Result<()> {
        require!(!ctx.accounts.config.paused, StrataError::Paused);
        require!(!entries.is_empty(), StrataError::EmptyBatch);

        let player = &mut ctx.accounts.player;
        let mut proceeds: u64 = 0;

        for entry in entries.iter() {
            let index = entry.kind as usize;
            require!(index < RESOURCE_COUNT, StrataError::UnknownResource);
            require!(
                player.resources[index] >= entry.amount,
                StrataError::InsufficientResources
            );

            player.resources[index] -= entry.amount;
            proceeds = proceeds
                .saturating_add(RESOURCE_VALUES[index].saturating_mul(entry.amount as u64));
        }

        player.balance = player.balance.saturating_add(proceeds);
        player.xp = player.xp.saturating_add(proceeds / 12);

        // TODO(token): once `config.token_mint` is set, replace the balance
        // field with a `mint_to` CPI into the player's associated token
        // account, authority = the config PDA.

        emit!(ResourcesSold {
            owner: player.owner,
            proceeds,
        });

        Ok(())
    }

    /* ----------------------------------------------------------------- */

    pub fn place_building(
        ctx: Context<UpdatePlayer>,
        kind: u8,
        x: i16,
        y: i16,
        z: i16,
        rotation: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, StrataError::Paused);
        require!(kind < 7, StrataError::UnknownBuilding);
        require!(rotation < 4, StrataError::InvalidParameter);

        let player = &mut ctx.accounts.player;
        require!(
            player.buildings.len() < MAX_BUILDINGS,
            StrataError::TooManyBuildings
        );

        // Placement must stay inside the claim. The client also checks
        // terrain flatness; the program only enforces what it can verify
        // cheaply, which is the boundary.
        require!(
            x >= 0 && z >= 0 && x < 80 && z < 80 && y > 0 && y < 96,
            StrataError::OutsideClaim
        );

        // Footprints may not overlap. O(n) over at most 32 buildings.
        let (w, d) = building_footprint(kind);
        for existing in player.buildings.iter() {
            let (ew, ed) = building_footprint(existing.kind);
            let overlaps = x < existing.x + ew as i16
                && x + w as i16 > existing.x
                && z < existing.z + ed as i16
                && z + d as i16 > existing.z;
            require!(!overlaps, StrataError::FootprintOccupied);
        }

        let workers_needed = building_workers(kind, 1);
        if workers_needed > 0 {
            let (used, available) = player.worker_balance();
            require!(
                used.saturating_add(workers_needed as u16) <= available,
                StrataError::NotEnoughWorkers
            );
        }

        let cost = building_cost_tokens(kind, 1);
        require!(player.balance >= cost, StrataError::InsufficientFunds);
        player.balance -= cost;

        player.buildings.push(Building {
            kind,
            level: 1,
            x,
            y,
            z,
            rotation,
            bore_depth: y,
            placed_at: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn upgrade_building(ctx: Context<UpdatePlayer>, index: u8) -> Result<()> {
        require!(!ctx.accounts.config.paused, StrataError::Paused);
        let player = &mut ctx.accounts.player;

        let slot = index as usize;
        require!(slot < player.buildings.len(), StrataError::UnknownBuilding);

        let (kind, level) = {
            let building = &player.buildings[slot];
            (building.kind, building.level)
        };
        require!(level < 5, StrataError::AlreadyMaxLevel);

        let cost = building_cost_tokens(kind, level + 1);
        require!(player.balance >= cost, StrataError::InsufficientFunds);
        player.balance -= cost;
        player.buildings[slot].level = level + 1;

        Ok(())
    }

    pub fn remove_building(ctx: Context<UpdatePlayer>, index: u8) -> Result<()> {
        let player = &mut ctx.accounts.player;
        let slot = index as usize;
        require!(slot < player.buildings.len(), StrataError::UnknownBuilding);

        let building = player.buildings[slot];
        // 40% of the current level's cost comes back. Enough that rearranging
        // isn't punishing, little enough that it isn't a free undo.
        let refund = building_cost_tokens(building.kind, building.level) * 40 / 100;
        player.balance = player.balance.saturating_add(refund);
        player.buildings.remove(slot);

        Ok(())
    }
}

/* ==========================================================================
   Accounts
   ========================================================================== */

#[account]
pub struct GameConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub token_mint: Option<Pubkey>,
    pub market_fee_bps: u16,
    pub burn_share_bps: u16,
    pub drop_table_version: u16,
    pub paused: bool,
    pub bump: u8,
}

impl GameConfig {
    pub const SPACE: usize = 8 + 32 + 32 + (1 + 32) + 2 + 2 + 2 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug)]
pub struct EquippedStats {
    pub mining_speed: i16,
    pub yield_bonus: i16,
    pub energy_max: i16,
    pub energy_regen: i16,
    pub energy_cost: i16,
    pub extractor_rate: i16,
    pub luck: i16,
    pub refine_speed: i16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct Building {
    pub kind: u8,
    pub level: u8,
    pub x: i16,
    pub y: i16,
    pub z: i16,
    pub rotation: u8,
    pub bore_depth: i16,
    pub placed_at: i64,
}

impl Building {
    pub const SPACE: usize = 1 + 1 + 2 + 2 + 2 + 1 + 2 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ResourceEntry {
    pub kind: u8,
    pub amount: u32,
}

#[account]
pub struct Player {
    pub owner: Pubkey,
    pub claim_seed: u32,
    pub created_at: i64,
    pub last_settled_at: i64,
    pub xp: u64,
    pub total_mined: u64,
    pub packs_opened: u32,
    /// Hundredths of a unit, as of `energy_at`.
    pub energy_value: u64,
    pub energy_at: i64,
    /// Interim currency ledger. Replaced by an SPL token account at launch.
    pub balance: u64,
    pub resources: [u32; RESOURCE_COUNT],
    pub buildings: Vec<Building>,
    pub equipped_stats: EquippedStats,
    pub next_commit_nonce: u32,
    pub bump: u8,
}

impl Player {
    pub const SPACE: usize = 8
        + 32
        + 4
        + 8
        + 8
        + 8
        + 8
        + 4
        + 8
        + 8
        + 8
        + (4 * RESOURCE_COUNT)
        + (4 + Building::SPACE * MAX_BUILDINGS)
        + (2 * 8)
        + 4
        + 1;

    /// Energy is derived, never ticked. Same formula as `currentEnergy` in
    /// `src/sim/economy.ts`, in integer hundredths.
    pub fn current_energy(&self, now: i64) -> u64 {
        let elapsed = now.saturating_sub(self.energy_at).max(0) as u64;
        let regen_rate = BASE_ENERGY_REGEN_PER_SEC
            .saturating_mul(100u64.saturating_add(self.equipped_stats.energy_regen.max(0) as u64))
            / 100;
        let regained = elapsed.saturating_mul(regen_rate);
        self.energy_value
            .saturating_add(regained)
            .min(self.energy_max())
    }

    pub fn energy_max(&self) -> u64 {
        BASE_ENERGY_MAX
            .saturating_add((self.equipped_stats.energy_max.max(0) as u64) * ENERGY_SCALE)
    }

    pub fn total_resources(&self) -> u64 {
        self.resources.iter().map(|n| *n as u64).sum()
    }

    pub fn storage_capacity(&self) -> u64 {
        let mut capacity = BASE_STORAGE;
        for building in self.buildings.iter() {
            if building.kind == 3 {
                // silo: 2500 * 1.8^(level-1), integer approximation
                let mut add = 2_500u64;
                for _ in 1..building.level {
                    add = add * 18 / 10;
                }
                capacity = capacity.saturating_add(add);
            }
        }
        capacity
    }

    pub fn worker_balance(&self) -> (u16, u16) {
        let mut used = 0u16;
        let mut available = BASE_WORKERS;
        for building in self.buildings.iter() {
            let workers = building_workers(building.kind, building.level);
            if workers < 0 {
                available = available.saturating_add(workers.unsigned_abs() as u16);
            } else {
                used = used.saturating_add(workers as u16);
            }
        }
        (used, available)
    }

    /// Power efficiency in percent, clamped to [15, 100] — matching the
    /// client's soft-failure behaviour rather than halting production.
    pub fn power_efficiency(&self) -> u64 {
        let mut produced = 0i64;
        let mut consumed = 0i64;
        for building in self.buildings.iter() {
            let power = building_power(building.kind, building.level);
            if power > 0 {
                produced += power as i64;
            } else {
                consumed += -(power as i64);
            }
        }
        if consumed <= 0 {
            return 100;
        }
        ((produced * 100 / consumed) as u64).clamp(15, 100)
    }

    /// Advances every extractor's bore and credits its output.
    ///
    /// Deliberately coarse compared to the client's projection: the client
    /// shows an optimistic preview, and the program's number is the one that
    /// counts. Erring low here means players are occasionally pleasantly
    /// surprised rather than silently shortchanged.
    pub fn simulate_extractors(&mut self, window_secs: u64) -> u64 {
        let efficiency = self.power_efficiency();
        let capacity = self.storage_capacity();
        let mut held = self.total_resources();
        let mut produced_total = 0u64;

        let rate_bonus = 100u64.saturating_add(self.equipped_stats.extractor_rate.max(0) as u64);

        for index in 0..self.buildings.len() {
            let (kind, level, bore_depth) = {
                let building = &self.buildings[index];
                (building.kind, building.level, building.bore_depth)
            };
            if kind != 0 {
                continue;
            }

            // 0.005 blocks/sec per level, in thousandths to stay integer.
            let descent = (5u64 * level as u64 * window_secs * efficiency) / (1_000 * 100);
            let new_depth = (bore_depth as i64 - descent as i64).max(1) as i16;
            self.buildings[index].bore_depth = new_depth;

            let sample = ((bore_depth as i64 + new_depth as i64) / 2) as i16;
            let (resource_kind, density) = ore_at_depth(sample);
            if density == 0 {
                continue;
            }

            // extractorRate(level) = 0.55 * 1.55^(level-1), in thousandths.
            let mut rate = 550u64;
            for _ in 1..level {
                rate = rate * 155 / 100;
            }

            let produced = rate
                .saturating_mul(window_secs)
                .saturating_mul(rate_bonus)
                .saturating_mul(efficiency)
                .saturating_mul(density)
                / (1_000 * 100 * 100 * 100);

            let headroom = capacity.saturating_sub(held);
            let granted = produced.min(headroom);
            if granted == 0 {
                continue;
            }

            let slot = &mut self.resources[resource_kind as usize];
            *slot = slot.saturating_add(granted as u32);
            held = held.saturating_add(granted);
            produced_total = produced_total.saturating_add(granted);
        }

        produced_total
    }
}

/* ==========================================================================
   Building tables — mirrors of `src/sim/buildings.ts`
   ========================================================================== */

/// (width, depth) per building kind.
pub fn building_footprint(kind: u8) -> (u8, u8) {
    match kind {
        3 => (3, 3), // silo
        5 => (7, 7), // market
        _ => (5, 5),
    }
}

/// Positive consumes crew, negative supplies it.
pub fn building_workers(kind: u8, level: u8) -> i16 {
    let base: i16 = match kind {
        0 => 2,  // extractor
        1 => 3,  // smelter
        2 => 2,  // generator
        3 => 1,  // silo
        4 => -4, // habitat
        5 => 4,  // market
        6 => 3,  // lab
        _ => 0,
    };
    if kind == 4 {
        base - (level as i16 - 1) * 3
    } else {
        base + (level as i16 - 1) / 2
    }
}

/// Energy per second. Positive produces.
pub fn building_power(kind: u8, level: u8) -> i16 {
    let base: i16 = match kind {
        0 => -3,
        1 => -4,
        2 => 14,
        3 => -1,
        4 => -2,
        5 => -3,
        6 => -5,
        _ => 0,
    };
    let mut value = base as i32;
    let scale = if kind == 2 { 160 } else { 135 };
    for _ in 1..level {
        value = value * scale / 100;
    }
    value as i16
}

pub fn building_cost_tokens(kind: u8, level: u8) -> u64 {
    let (base, scale): (u64, u64) = match kind {
        0 => (400, 190),
        1 => (650, 185),
        2 => (500, 180),
        3 => (220, 175),
        4 => (300, 170),
        5 => (1_800, 200),
        6 => (1_400, 195),
        _ => (0, 100),
    };
    let mut cost = base;
    for _ in 1..level {
        cost = cost * scale / 100;
    }
    cost
}

/// Dominant ore and density (percent) at a bore depth.
///
/// A flattened form of the `STRATA` table in `src/sim/strata.ts`. The client
/// distributes across the full weighted mix; the program credits the band's
/// dominant ore only. The difference favours the client's preview being
/// slightly richer in variety, never richer in total.
pub fn ore_at_depth(y: i16) -> (u8, u64) {
    match y {
        y if y >= 34 => (0, 55),  // Upper Stone -> coal
        y if y >= 16 => (3, 70),  // Deepslate -> silver
        y if y >= 4 => (5, 82),   // Basalt Margin -> crystal
        _ => (0, 0),              // Bedrock
    }
}

/// FNV-1a over the owner's bytes. Matches `seedFromString` in `src/lib/rng.ts`
/// closely enough that the claim is reproducible; the client derives from the
/// base58 string, so this is the one place the two intentionally differ and
/// the client's value is authoritative at `init_player` time.
pub fn derive_claim_seed(owner: &Pubkey) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in owner.to_bytes().iter() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

/* ==========================================================================
   Contexts
   ========================================================================== */

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = GameConfig::SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, GameConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: recorded as the fee destination; never written by this program.
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ StrataError::Unauthorized
    )]
    pub config: Account<'info, GameConfig>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitPlayer<'info> {
    #[account(
        init,
        payer = owner,
        space = Player::SPACE,
        seeds = [b"player", owner.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePlayer<'info> {
    #[account(
        mut,
        seeds = [b"player", owner.key().as_ref()],
        bump = player.bump,
        has_one = owner @ StrataError::Unauthorized
    )]
    pub player: Account<'info, Player>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,

    pub owner: Signer<'info>,
}

/* ==========================================================================
   Events
   ========================================================================== */

#[event]
pub struct PlayerInitialized {
    pub owner: Pubkey,
    pub claim_seed: u32,
    pub at: i64,
}

#[event]
pub struct MiningSettled {
    pub owner: Pubkey,
    pub granted: u64,
    pub energy_spent: u64,
    pub at: i64,
}

#[event]
pub struct YieldClaimed {
    pub owner: Pubkey,
    pub produced: u64,
    pub window: u64,
    pub at: i64,
}

#[event]
pub struct ResourcesSold {
    pub owner: Pubkey,
    pub proceeds: u64,
}

/* ==========================================================================
   Errors
   ========================================================================== */

#[error_code]
pub enum StrataError {
    #[msg("The game is paused")]
    Paused,
    #[msg("Only the configured authority may do that")]
    Unauthorized,
    #[msg("Marketplace fee cannot exceed 10%")]
    FeeTooHigh,
    #[msg("The token mint has already been set")]
    MintAlreadySet,
    #[msg("Invalid parameter")]
    InvalidParameter,
    #[msg("Nothing to settle")]
    EmptyBatch,
    #[msg("Unknown resource kind")]
    UnknownResource,
    #[msg("Unknown building")]
    UnknownBuilding,
    #[msg("Mining batch claims more energy than has accrued")]
    EnergyOverclaim,
    #[msg("Mining batch claims more yield than the energy spent allows")]
    YieldOverclaim,
    #[msg("Nothing has accrued yet")]
    NothingAccrued,
    #[msg("Not enough resources")]
    InsufficientResources,
    #[msg("Not enough STRATA")]
    InsufficientFunds,
    #[msg("Not enough workers — build a Habitat")]
    NotEnoughWorkers,
    #[msg("This claim already has the maximum number of buildings")]
    TooManyBuildings,
    #[msg("Another building already occupies that footprint")]
    FootprintOccupied,
    #[msg("Placement is outside your claim")]
    OutsideClaim,
    #[msg("Already at maximum level")]
    AlreadyMaxLevel,
}
