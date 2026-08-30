import { assertTableSums, PPM, rollFromSeed, rollRange, weightedPick, type WeightedEntry } from "@/lib/rng";
import { pickArchetype, rollItem, type RolledItem } from "./items";
import type { PackKind, Rarity, ResourceBag, ResourceKind } from "./types";
import { ITEM_SLOTS, RARITIES } from "./types";
import { bagAdd } from "./resources";

/**
 * Supply crates.
 *
 * Every number in this file is public and every roll is reproducible from a
 * pair of transactions. That is deliberate: odds you can't verify are just a
 * claim, and a game that sells randomness should expect to be checked.
 *
 * `DROP_TABLE_VERSION` is written into every reveal. If a table ever changes,
 * the version bumps, and historical reveals stay auditable against the table
 * that was live when they happened.
 */
export const DROP_TABLE_VERSION = 1;

/* ==========================================================================
   Rarity tables — parts per million, must sum to exactly 1_000_000
   ========================================================================== */

const SUPPLY_TABLE: readonly WeightedEntry<Rarity>[] = [
  { value: "common", ppm: 620_000 },
  { value: "uncommon", ppm: 280_000 },
  { value: "rare", ppm: 82_000 },
  { value: "epic", ppm: 15_000 },
  { value: "legendary", ppm: 2_700 },
  { value: "mythic", ppm: 300 },
];

const PROSPECTOR_TABLE: readonly WeightedEntry<Rarity>[] = [
  { value: "common", ppm: 380_000 },
  { value: "uncommon", ppm: 400_000 },
  { value: "rare", ppm: 165_000 },
  { value: "epic", ppm: 45_000 },
  { value: "legendary", ppm: 9_000 },
  { value: "mythic", ppm: 1_000 },
];

const DEEPCORE_TABLE: readonly WeightedEntry<Rarity>[] = [
  { value: "common", ppm: 120_000 },
  { value: "uncommon", ppm: 330_000 },
  { value: "rare", ppm: 350_000 },
  { value: "epic", ppm: 155_000 },
  { value: "legendary", ppm: 40_000 },
  { value: "mythic", ppm: 5_000 },
];

/** The final draw of a Deep Core Vault, which is guaranteed Rare or better. */
const DEEPCORE_FINAL_TABLE: readonly WeightedEntry<Rarity>[] = [
  { value: "rare", ppm: 620_000 },
  { value: "epic", ppm: 300_000 },
  { value: "legendary", ppm: 68_000 },
  { value: "mythic", ppm: 12_000 },
];

// Fail loudly at import time rather than silently shipping skewed odds.
assertTableSums("supply", SUPPLY_TABLE);
assertTableSums("prospector", PROSPECTOR_TABLE);
assertTableSums("deepcore", DEEPCORE_TABLE);
assertTableSums("deepcore_final", DEEPCORE_FINAL_TABLE);

/* ==========================================================================
   Pack definitions
   ========================================================================== */

export interface ResourceGrant {
  readonly kind: ResourceKind;
  readonly min: number;
  readonly max: number;
}

export interface PackDef {
  readonly kind: PackKind;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  /** Whole STRATA. Converted to base units at the chain boundary. */
  readonly priceTokens: number;
  readonly draws: number;
  readonly table: readonly WeightedEntry<Rarity>[];
  /** Overrides `table` for the last draw, when a floor is guaranteed. */
  readonly finalTable?: readonly WeightedEntry<Rarity>[];
  readonly resourceGrants: readonly ResourceGrant[];
  /** Chance in ppm of a bonus currency drop. */
  readonly bonusTokenPpm: number;
  readonly bonusTokenRange: readonly [number, number];
  readonly accent: string;
  readonly floorLabel: string | null;
}

export const PACK_DEFS: Record<PackKind, PackDef> = {
  supply: {
    kind: "supply",
    name: "Supply Crate",
    tagline: "Standard resupply",
    description:
      "What the company drops on your claim every shift. Three draws, mostly hand tools and " +
      "enough ore to keep a smelter warm.",
    priceTokens: 250,
    draws: 3,
    table: SUPPLY_TABLE,
    resourceGrants: [
      { kind: "coal", min: 20, max: 60 },
      { kind: "iron", min: 12, max: 40 },
    ],
    bonusTokenPpm: 60_000,
    bonusTokenRange: [40, 180],
    accent: "#7c8798",
    floorLabel: null,
  },
  prospector: {
    kind: "prospector",
    name: "Prospector Case",
    tagline: "Surveyed and sorted",
    description:
      "Assembled by someone who actually went down the shaft. Four draws with meaningfully " +
      "better odds, and a bundle of mid-tier ore to go with them.",
    priceTokens: 1_200,
    draws: 4,
    table: PROSPECTOR_TABLE,
    resourceGrants: [
      { kind: "coal", min: 60, max: 140 },
      { kind: "copper", min: 25, max: 70 },
      { kind: "silver", min: 8, max: 28 },
    ],
    bonusTokenPpm: 120_000,
    bonusTokenRange: [200, 900],
    accent: "#38bdf8",
    floorLabel: null,
  },
  deepcore: {
    kind: "deepcore",
    name: "Deep Core Vault",
    tagline: "Guaranteed Rare or better",
    description:
      "Pulled from the basalt margin. Five draws on the best table in the game, and the last " +
      "one cannot roll below Rare.",
    priceTokens: 5_000,
    draws: 5,
    table: DEEPCORE_TABLE,
    finalTable: DEEPCORE_FINAL_TABLE,
    resourceGrants: [
      { kind: "coal", min: 150, max: 320 },
      { kind: "titanium", min: 20, max: 55 },
      { kind: "crystal", min: 6, max: 22 },
    ],
    bonusTokenPpm: 220_000,
    bonusTokenRange: [900, 4_200],
    accent: "#fbbf24",
    floorLabel: "Rare floor on final draw",
  },
};

export const PACK_LIST: readonly PackDef[] = [
  PACK_DEFS.supply,
  PACK_DEFS.prospector,
  PACK_DEFS.deepcore,
];

/* ==========================================================================
   Luck

   Equipped Scanner luck shifts weight out of Common and into everything above
   it, proportional to tier. Integer-only, and the leftover from truncation is
   returned to Common so the table always sums to exactly PPM.
   ========================================================================== */

export const MAX_EFFECTIVE_LUCK = 60;

export function applyLuck(
  table: readonly WeightedEntry<Rarity>[],
  luckPct: number
): readonly WeightedEntry<Rarity>[] {
  const luck = Math.max(0, Math.min(MAX_EFFECTIVE_LUCK, Math.trunc(luckPct)));
  if (luck === 0) return table;

  const common = table.find((e) => e.value === "common");
  if (!common) return table;

  // Move up to half of luck% out of the Common bucket.
  const budget = Math.trunc((common.ppm * luck) / 200);
  const upper = table.filter((e) => e.value !== "common");

  // Weight the redistribution by tier so luck helps the top end most, but
  // still moves the bulk into the tiers a player will realistically see.
  const weights = upper.map((e) => RARITIES.indexOf(e.value));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  let distributed = 0;
  const result: WeightedEntry<Rarity>[] = [{ value: "common", ppm: 0 }];

  upper.forEach((entry, i) => {
    const share = Math.trunc((budget * weights[i]) / weightSum);
    distributed += share;
    result.push({ value: entry.value, ppm: entry.ppm + share });
  });

  result[0] = { value: "common", ppm: common.ppm - distributed };

  // Preserve declaration order — the walk order is part of the spec.
  const byValue = new Map(result.map((e) => [e.value, e]));
  const ordered = table.map((e) => byValue.get(e.value)!);

  const total = ordered.reduce((n, e) => n + e.ppm, 0);
  if (total !== PPM) {
    // Truncation drift; hand it back to Common so odds never silently inflate.
    ordered[0] = { value: "common", ppm: ordered[0].ppm + (PPM - total) };
  }
  return ordered;
}

/* ==========================================================================
   Opening

   This function is the reference implementation of the pack contents. The
   Rust program in `programs/strata-packs` must produce identical output for
   identical input; `scripts/verify-reveal.ts` checks a reveal against it.
   ========================================================================== */

export interface PackOutcome {
  items: RolledItem[];
  resources: ResourceBag;
  bonusTokens: number;
  /** The table actually used, after luck. Surfaced in the reveal UI. */
  effectiveTable: readonly WeightedEntry<Rarity>[];
}

export function openPack(kind: PackKind, seed: Uint8Array, luckPct = 0): PackOutcome {
  const def = PACK_DEFS[kind];
  const effectiveTable = applyLuck(def.table, luckPct);
  const items: RolledItem[] = [];

  for (let i = 0; i < def.draws; i++) {
    const isFinal = i === def.draws - 1;
    const table =
      isFinal && def.finalTable ? applyLuck(def.finalTable, luckPct) : effectiveTable;

    // Three independent draws per item: rarity, slot, archetype. Distinct
    // index offsets keep them from correlating with each other.
    const rarity = weightedPick(table, rollFromSeed(seed, i * 64 + 0));
    const slot = ITEM_SLOTS[Number(rollFromSeed(seed, i * 64 + 1) % BigInt(ITEM_SLOTS.length))];
    const archetype = pickArchetype(slot, rollFromSeed(seed, i * 64 + 2));

    items.push(rollItem(archetype, rarity, seed, i));
  }

  const resources: ResourceBag = {};
  def.resourceGrants.forEach((grant, i) => {
    const qty = rollRange(rollFromSeed(seed, 4_096 + i), grant.min, grant.max);
    bagAdd(resources, grant.kind, qty);
  });

  const bonusRoll = rollFromSeed(seed, 8_192);
  const hitBonus = Number(bonusRoll % BigInt(PPM)) < def.bonusTokenPpm;
  const bonusTokens = hitBonus
    ? rollRange(rollFromSeed(seed, 8_193), def.bonusTokenRange[0], def.bonusTokenRange[1])
    : 0;

  return { items, resources, bonusTokens, effectiveTable };
}

/** Odds rendered as percentages for the pack detail panel. */
export function tableAsPercentages(
  table: readonly WeightedEntry<Rarity>[]
): Array<{ rarity: Rarity; pct: number; ppm: number }> {
  return table.map((e) => ({
    rarity: e.value,
    ppm: e.ppm,
    pct: (e.ppm / PPM) * 100,
  }));
}

/** Expected value of a pack in whole STRATA. Used by the economy docs + tuning. */
export function expectedPackValue(kind: PackKind, luckPct = 0): number {
  const def = PACK_DEFS[kind];
  const table = applyLuck(def.table, luckPct);
  // Average salvage value by rarity, matching `salvageValue` at 50% quality.
  const bySalvage: Record<Rarity, number> = {
    common: 40,
    uncommon: 110,
    rare: 320,
    epic: 900,
    legendary: 2_600,
    mythic: 7_400,
  };
  let perDraw = 0;
  for (const e of table) perDraw += (e.ppm / PPM) * bySalvage[e.value];
  return Math.round(perDraw * def.draws);
}
