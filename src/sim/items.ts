import { rollFromSeed } from "@/lib/rng";
import type { ItemSlot, Rarity, StatBlock, StatKey } from "./types";
import { RARITIES } from "./types";

/**
 * Equipment archetypes and the rules for rolling an instance of one.
 *
 * The roll is fully determined by `(seed, drawIndex)`, so a player can hand
 * anyone their reveal transaction and that person can recompute the exact item
 * that came out of it. Everything here is therefore integer arithmetic — see
 * the note in `lib/rng.ts` about why floats are banned on this path.
 */

/* ==========================================================================
   Stat ranges

   A range is written `[worst, best]`, not `[min, max]`. For `energyCost`,
   where lower is better, that means `[-4, -12]` — worst is -4%, best is -12%.
   Roll quality is measured as the distance travelled from worst to best, so a
   100%-quality Null Rig is the one with the *most* negative energy cost.
   ========================================================================== */

export type StatRange = readonly [worst: number, best: number];

export interface ItemArchetype {
  readonly key: string;
  readonly name: string;
  readonly slot: ItemSlot;
  readonly flavor: string;
  /** Base ranges at Common. Higher rarities scale these; see RARITY_SCALE. */
  readonly stats: Partial<Record<StatKey, StatRange>>;
  /** Weight within its slot when a pack rolls an item of this slot. */
  readonly weight: number;
  /** Voxel silhouette id, used by the item preview renderer. */
  readonly shape: string;
}

/**
 * Rarity multiplies base stats. Stored in permille so the Rust program can do
 * `(base * scale) / 1000` in i64 and land on the same integer we do.
 */
export const RARITY_SCALE_PERMILLE: Record<Rarity, number> = {
  common: 1000,
  uncommon: 1450,
  rare: 2100,
  epic: 3000,
  legendary: 4300,
  mythic: 6200,
};

export const ITEM_ARCHETYPES: readonly ItemArchetype[] = [
  /* ---- pick: hand mining ------------------------------------------------- */
  {
    key: "field_pick",
    name: "Field Pick",
    slot: "pick",
    shape: "pick_basic",
    weight: 34,
    flavor: "Company issue. Blunt, reliable, and yours to keep.",
    stats: { miningSpeed: [4, 10], energyCost: [-1, -4] },
  },
  {
    key: "tungsten_pick",
    name: "Tungsten Pick",
    slot: "pick",
    shape: "pick_heavy",
    weight: 28,
    flavor: "Heavy head, short haft. It goes through deepslate like wet chalk.",
    stats: { miningSpeed: [7, 14], yieldBonus: [2, 6] },
  },
  {
    key: "resonant_pick",
    name: "Resonant Pick",
    slot: "pick",
    shape: "pick_tuned",
    weight: 24,
    flavor: "Tuned to the seam. Strikes where the rock already wanted to split.",
    stats: { miningSpeed: [5, 11], luck: [3, 8] },
  },
  {
    key: "corebreaker",
    name: "Corebreaker",
    slot: "pick",
    shape: "pick_core",
    weight: 14,
    flavor: "Twice the swing, twice the appetite. Bring a spare cell.",
    stats: { miningSpeed: [11, 19], energyCost: [3, 7] },
  },

  /* ---- drill: extractor throughput --------------------------------------- */
  {
    key: "standard_bit",
    name: "Standard Bit",
    slot: "drill",
    shape: "drill_basic",
    weight: 34,
    flavor: "Fits every extractor mount ever manufactured.",
    stats: { extractorRate: [5, 12] },
  },
  {
    key: "diamond_bit",
    name: "Diamond Bit",
    slot: "drill",
    shape: "drill_diamond",
    weight: 27,
    flavor: "Cuts continuously. Draws power like it's being paid to.",
    stats: { extractorRate: [9, 18], energyCost: [1, 4] },
  },
  {
    key: "harmonic_bit",
    name: "Harmonic Bit",
    slot: "drill",
    shape: "drill_harmonic",
    weight: 25,
    flavor: "Vibrates the seam apart. The smelters run warmer near one.",
    stats: { extractorRate: [6, 13], refineSpeed: [3, 9] },
  },
  {
    key: "void_auger",
    name: "Void Auger",
    slot: "drill",
    shape: "drill_void",
    weight: 14,
    flavor: "It does not turn so much as insist.",
    stats: { extractorRate: [14, 25], energyCost: [3, 8] },
  },

  /* ---- cell: energy pool ------------------------------------------------- */
  {
    key: "cell_mk1",
    name: "Cell Mk I",
    slot: "cell",
    shape: "cell_basic",
    weight: 34,
    flavor: "A brick of copper and hope.",
    stats: { energyMax: [8, 18], energyRegen: [3, 8] },
  },
  {
    key: "dense_cell",
    name: "Dense Cell",
    slot: "cell",
    shape: "cell_dense",
    weight: 27,
    flavor: "Holds a lot. Refills like it resents you.",
    stats: { energyMax: [17, 31] },
  },
  {
    key: "flux_cell",
    name: "Flux Cell",
    slot: "cell",
    shape: "cell_flux",
    weight: 25,
    flavor: "Small pool, fast tap. Built for people who never stop swinging.",
    stats: { energyRegen: [9, 17] },
  },
  {
    key: "crystal_battery",
    name: "Crystal Battery",
    slot: "cell",
    shape: "cell_crystal",
    weight: 14,
    flavor: "A focused crystal in a cage, doing something nobody has fully explained.",
    stats: { energyMax: [13, 23], energyRegen: [6, 13] },
  },

  /* ---- scanner: luck and yield ------------------------------------------- */
  {
    key: "survey_lens",
    name: "Survey Lens",
    slot: "scanner",
    shape: "scan_lens",
    weight: 34,
    flavor: "Shows you the seam one block before your pick finds it.",
    stats: { luck: [4, 9] },
  },
  {
    key: "deep_scanner",
    name: "Deep Scanner",
    slot: "scanner",
    shape: "scan_deep",
    weight: 27,
    flavor: "Reads eight metres down. Mostly correctly.",
    stats: { luck: [7, 14], yieldBonus: [2, 5] },
  },
  {
    key: "assay_rig",
    name: "Assay Rig",
    slot: "scanner",
    shape: "scan_assay",
    weight: 25,
    flavor: "Sorts tailings you'd have thrown out. Pays for itself in a week.",
    stats: { yieldBonus: [6, 13] },
  },
  {
    key: "oracle_array",
    name: "Oracle Array",
    slot: "scanner",
    shape: "scan_oracle",
    weight: 14,
    flavor: "Points at things before there is anything to point at.",
    stats: { luck: [11, 21], refineSpeed: [3, 8] },
  },

  /* ---- frame: energy efficiency ------------------------------------------ */
  {
    key: "work_harness",
    name: "Work Harness",
    slot: "frame",
    shape: "frame_basic",
    weight: 34,
    flavor: "Takes the weight off your shoulders and puts it on the straps.",
    stats: { energyCost: [-4, -9] },
  },
  {
    key: "servo_frame",
    name: "Servo Frame",
    slot: "frame",
    shape: "frame_servo",
    weight: 27,
    flavor: "Assists the downswing. Feels like the rock is helping.",
    stats: { energyCost: [-7, -14], miningSpeed: [2, 6] },
  },
  {
    key: "plated_exo",
    name: "Plated Exo",
    slot: "frame",
    shape: "frame_plated",
    weight: 25,
    flavor: "Titanium over the shoulders, cell mounts down the spine.",
    stats: { energyCost: [-5, -11], energyMax: [6, 15] },
  },
  {
    key: "null_rig",
    name: "Null Rig",
    slot: "frame",
    shape: "frame_null",
    weight: 14,
    flavor: "You stop noticing the effort. That is either very good or very bad.",
    stats: { energyCost: [-10, -20], luck: [2, 6] },
  },
];

export const ARCHETYPE_BY_KEY = new Map(ITEM_ARCHETYPES.map((a) => [a.key, a]));

export const ARCHETYPES_BY_SLOT: Record<ItemSlot, ItemArchetype[]> = ITEM_ARCHETYPES.reduce(
  (acc, a) => {
    (acc[a.slot] ??= []).push(a);
    return acc;
  },
  {} as Record<ItemSlot, ItemArchetype[]>
);

/* ==========================================================================
   Rolling
   ========================================================================== */

/** Resolution of a stat roll. 10000 steps between worst and best. */
const ROLL_STEPS = 10_000n;

/**
 * Integer lerp from `worst` to `best`, positioned by `roll`.
 *
 * Rust equivalent:
 *   let t = (roll % 10_001) as i64;
 *   worst + ((best - worst) * t) / 10_000
 *
 * Truncation toward zero in both languages, so results match exactly.
 */
function lerpStat(roll: bigint, worst: number, best: number): { value: number; t: number } {
  const steps = Number(roll % (ROLL_STEPS + 1n));
  const value = worst + Math.trunc(((best - worst) * steps) / Number(ROLL_STEPS));
  return { value, t: steps / Number(ROLL_STEPS) };
}

/** Applies rarity scaling to a base stat bound. `(base * permille) / 1000`. */
function scaleBound(base: number, permille: number): number {
  return Math.trunc((base * permille) / 1000);
}

export interface RolledItem {
  archetype: ItemArchetype;
  rarity: Rarity;
  stats: StatBlock;
  /** 0-100. How close every stat landed to the top of its range. */
  quality: number;
}

/**
 * Rolls one item. `seed` is the reveal seed; `index` distinguishes draws
 * within a single pack so two identical archetypes in one pack differ.
 */
export function rollItem(
  archetype: ItemArchetype,
  rarity: Rarity,
  seed: Uint8Array,
  index: number
): RolledItem {
  const permille = RARITY_SCALE_PERMILLE[rarity];
  const stats: StatBlock = {};
  let qualitySum = 0;
  let statCount = 0;

  // Offset each stat's roll so the same seed doesn't correlate every stat.
  let statOffset = 0;
  for (const [key, range] of Object.entries(archetype.stats) as [StatKey, StatRange][]) {
    const roll = rollFromSeed(seed, index * 64 + 16 + statOffset);
    const worst = scaleBound(range[0], permille);
    const best = scaleBound(range[1], permille);
    const { value, t } = lerpStat(roll, worst, best);
    stats[key] = value;
    qualitySum += t;
    statCount++;
    statOffset++;
  }

  return {
    archetype,
    rarity,
    stats,
    quality: statCount === 0 ? 0 : Math.round((qualitySum / statCount) * 100),
  };
}

/** Picks an archetype for a slot using the declared weights. */
export function pickArchetype(slot: ItemSlot, roll: bigint): ItemArchetype {
  const pool = ARCHETYPES_BY_SLOT[slot];
  const total = pool.reduce((n, a) => n + a.weight, 0);
  let target = Number(roll % BigInt(total));
  for (const a of pool) {
    target -= a.weight;
    if (target < 0) return a;
  }
  return pool[pool.length - 1];
}

/* ==========================================================================
   Derived values
   ========================================================================== */

/**
 * A single scalar for sorting and salvage pricing.
 *
 * Sums the absolute magnitude of every stat, so a `-20%` energy cost counts as
 * strongly as `+20%` yield. Weighted by rarity tier so a poorly-rolled Mythic
 * still outranks a perfect Common — which is what players expect, and what
 * keeps high rarities desirable even on a bad roll.
 */
export function itemPower(stats: StatBlock, rarity: Rarity): number {
  let magnitude = 0;
  for (const v of Object.values(stats)) magnitude += Math.abs(v ?? 0);
  const tier = RARITIES.indexOf(rarity);
  return Math.round(magnitude * (1 + tier * 0.35));
}

/** Base salvage payout in whole STRATA. The main item sink. */
export function salvageValue(stats: StatBlock, rarity: Rarity, quality: number): number {
  const base = [40, 110, 320, 900, 2600, 7400][RARITIES.indexOf(rarity)] ?? 40;
  // Quality moves salvage between 70% and 130% of base.
  return Math.round(base * (0.7 + (quality / 100) * 0.6) * (1 + itemPower(stats, rarity) / 400));
}

/** Human-readable stat line, e.g. "+14% Mining Speed". */
export function formatStat(key: StatKey, value: number): string {
  const sign = value > 0 ? "+" : "";
  const labels: Record<StatKey, string> = {
    miningSpeed: "Mining Speed",
    yieldBonus: "Yield",
    energyMax: "Max Energy",
    energyRegen: "Energy Regen",
    energyCost: "Energy Cost",
    extractorRate: "Extractor Rate",
    luck: "Luck",
    refineSpeed: "Refine Speed",
  };
  const unit = key === "energyMax" ? "" : "%";
  return `${sign}${value}${unit} ${labels[key]}`;
}

/** True when this stat value helps the player, accounting for inverted stats. */
export function isStatBeneficial(key: StatKey, value: number): boolean {
  return key === "energyCost" ? value < 0 : value > 0;
}
