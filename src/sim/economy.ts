import {
  BUILDING_DEFS,
  buildingPower,
  buildingWorkers,
  extractorRate,
  generatorFuelBurn,
  labLuck,
  labRefineSpeed,
  marketFeeDiscountBps,
  siloCapacity,
} from "./buildings";
import { RECIPES, RESOURCE_DEFS, bagAdd, bagSubtract } from "./resources";
import { SURFACE_Y, oreDensityAtDepth, oreMixAtDepth } from "./strata";
import type { BuildingKind, ResourceBag, ResourceKind, StatBlock, StatKey } from "./types";
import { MAX_EFFECTIVE_LUCK } from "./packs";

/**
 * Every formula that turns game state into numbers.
 *
 * Two properties matter more than the specific constants:
 *
 *  1. **Everything is a pure function of state + elapsed time.** Nothing here
 *     reads a clock or a random source. That is what lets the same code run in
 *     the client for prediction and in a program for settlement, and get the
 *     same answer.
 *
 *  2. **No compounding multipliers.** Bonuses are additive percentage points
 *     against a base, never multiplied together. Multiplicative stacking is
 *     how idle games accidentally ship a build that produces 10^12 of
 *     something on day four.
 */

/* ==========================================================================
   Baselines
   ========================================================================== */

export const BASE = {
  energyMax: 100,
  /** Energy per second with no equipment. Full refill takes ~42s. */
  energyRegen: 2.4,
  /** Milliseconds to break a hardness-1 block bare-handed. */
  swingMs: 420,
  /** Energy drained by breaking a hardness-1 block. */
  swingEnergy: 1.15,
  /** Storage before any Silo. */
  storage: 3_000,
  /** Workers available before any Habitat. */
  workers: 4,
  /** Marketplace fee in basis points, before Market Hub discounts. */
  marketFeeBps: 250,
} as const;

/** Bore descent in blocks per second, per Extractor level. */
export const BORE_RATE_PER_LEVEL = 0.005;

/* ==========================================================================
   Equipment aggregation
   ========================================================================== */

export interface EquippedLike {
  stats: StatBlock;
  equipped: boolean;
}

/** Sums the stats of everything currently equipped. Additive, never multiplied. */
export function aggregateItemStats(items: readonly EquippedLike[]): StatBlock {
  const total: StatBlock = {};
  for (const item of items) {
    if (!item.equipped) continue;
    for (const [key, value] of Object.entries(item.stats) as [StatKey, number][]) {
      total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

/* ==========================================================================
   City aggregation
   ========================================================================== */

export interface PlacedLike {
  kind: BuildingKind;
  level: number;
  boreDepth?: number;
}

export interface CityStats {
  /** Workers supplied by Habitats, plus the free baseline. */
  workersAvailable: number;
  workersUsed: number;
  powerProduced: number;
  powerConsumed: number;
  /** 0-1. Everything scales by this when the grid is short. */
  powerEfficiency: number;
  storageCap: number;
  luck: number;
  refineSpeed: number;
  marketFeeBps: number;
  hasMarket: boolean;
  counts: Record<BuildingKind, number>;
  extractorCount: number;
  smelterCount: number;
}

export function deriveCityStats(buildings: readonly PlacedLike[]): CityStats {
  const counts = Object.fromEntries(
    Object.keys(BUILDING_DEFS).map((k) => [k, 0])
  ) as Record<BuildingKind, number>;

  let workersAvailable = BASE.workers;
  let workersUsed = 0;
  let powerProduced = 0;
  let powerConsumed = 0;
  let storageCap = BASE.storage;
  let luck = 0;
  let refineSpeed = 0;
  let feeDiscount = 0;

  for (const b of buildings) {
    counts[b.kind]++;

    const workers = buildingWorkers(b.kind, b.level);
    if (workers < 0) workersAvailable += -workers;
    else workersUsed += workers;

    const power = buildingPower(b.kind, b.level);
    if (power > 0) powerProduced += power;
    else powerConsumed += -power;

    switch (b.kind) {
      case "silo":
        storageCap += siloCapacity(b.level);
        break;
      case "lab":
        luck += labLuck(b.level);
        refineSpeed += labRefineSpeed(b.level);
        break;
      case "market":
        feeDiscount += marketFeeDiscountBps(b.level);
        break;
    }
  }

  // A power deficit is a soft failure: production scales down, nothing breaks.
  const powerEfficiency =
    powerConsumed <= 0 ? 1 : Math.max(0.15, Math.min(1, powerProduced / powerConsumed));

  return {
    workersAvailable,
    workersUsed,
    powerProduced: round2(powerProduced),
    powerConsumed: round2(powerConsumed),
    powerEfficiency: round2(powerEfficiency),
    storageCap,
    luck,
    refineSpeed,
    marketFeeBps: Math.max(50, BASE.marketFeeBps - feeDiscount),
    hasMarket: counts.market > 0,
    counts,
    extractorCount: counts.extractor,
    smelterCount: counts.smelter,
  };
}

/** Can this building be placed right now, given workers and unlocks? */
export function canAfford(
  kind: BuildingKind,
  city: CityStats,
  playerLevel: number
): { ok: true } | { ok: false; reason: string } {
  const def = BUILDING_DEFS[kind];

  if (playerLevel < def.unlockLevel) {
    return { ok: false, reason: `Unlocks at level ${def.unlockLevel}` };
  }
  if (def.maxCount !== null && city.counts[kind] >= def.maxCount) {
    return { ok: false, reason: `Only ${def.maxCount} allowed` };
  }
  const needed = buildingWorkers(kind, 1);
  if (needed > 0 && city.workersUsed + needed > city.workersAvailable) {
    return {
      ok: false,
      reason: `Needs ${needed} workers — build a Habitat`,
    };
  }
  return { ok: true };
}

/* ==========================================================================
   Player stats
   ========================================================================== */

export interface PlayerStats {
  energyMax: number;
  energyRegen: number;
  /** Percentage points, additive. */
  miningSpeed: number;
  yieldBonus: number;
  energyCost: number;
  extractorRate: number;
  luck: number;
  refineSpeed: number;
}

export function derivePlayerStats(
  itemStats: StatBlock,
  city: CityStats,
  playerLevel: number
): PlayerStats {
  // Levels give a small flat bonus so progress is visible even without drops.
  const levelBonus = (playerLevel - 1) * 1.5;

  return {
    energyMax: BASE.energyMax + (itemStats.energyMax ?? 0) + (playerLevel - 1) * 5,
    energyRegen: round2(BASE.energyRegen * (1 + (itemStats.energyRegen ?? 0) / 100)),
    miningSpeed: (itemStats.miningSpeed ?? 0) + levelBonus,
    yieldBonus: itemStats.yieldBonus ?? 0,
    energyCost: itemStats.energyCost ?? 0,
    extractorRate: itemStats.extractorRate ?? 0,
    luck: Math.min(MAX_EFFECTIVE_LUCK, (itemStats.luck ?? 0) + city.luck),
    refineSpeed: (itemStats.refineSpeed ?? 0) + city.refineSpeed,
  };
}

/* ==========================================================================
   Energy

   Stored as `(value, at)` rather than ticked. Current energy is *derived* from
   elapsed time, so the game is correct across tab suspension, reloads and —
   importantly — a chain where you cannot afford to write every second.
   ========================================================================== */

export function currentEnergy(
  storedValue: number,
  storedAt: number,
  stats: PlayerStats,
  now: number
): number {
  const elapsed = Math.max(0, (now - storedAt) / 1000);
  return Math.min(stats.energyMax, storedValue + elapsed * stats.energyRegen);
}

export function secondsUntilFull(current: number, stats: PlayerStats): number {
  if (current >= stats.energyMax) return 0;
  return (stats.energyMax - current) / stats.energyRegen;
}

/* ==========================================================================
   Hand mining
   ========================================================================== */

/** Milliseconds to break a block. */
export function miningTimeMs(hardness: number, stats: PlayerStats): number {
  if (!Number.isFinite(hardness)) return Infinity;
  return Math.max(90, (BASE.swingMs * hardness) / (1 + stats.miningSpeed / 100));
}

/** Energy consumed by breaking a block. */
export function miningEnergyCost(hardness: number, stats: PlayerStats): number {
  if (!Number.isFinite(hardness)) return Infinity;
  return Math.max(0.25, BASE.swingEnergy * hardness * (1 + stats.energyCost / 100));
}

/**
 * Units returned by breaking one ore block.
 *
 * Returns a float on purpose. The caller accumulates the fractional part, so
 * a +37% yield bonus reliably becomes an extra unit roughly every third block
 * instead of being rounded away — no RNG, no lost value.
 */
export function miningYield(stats: PlayerStats): number {
  return 1 * (1 + stats.yieldBonus / 100);
}

/* ==========================================================================
   Progression
   ========================================================================== */

/** XP required to advance *from* `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.floor(120 * Math.pow(level, 1.55));
}

export function levelFromXp(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let remaining = xp;
  let needed = xpToNext(level);
  while (remaining >= needed && level < 60) {
    remaining -= needed;
    level++;
    needed = xpToNext(level);
  }
  return { level, into: remaining, needed };
}

/** XP awarded for breaking a block of a given hardness. */
export function xpForBlock(hardness: number): number {
  return Number.isFinite(hardness) ? Math.max(1, Math.round(hardness * 2)) : 0;
}

/* ==========================================================================
   Passive production

   Called with the elapsed time since the last settlement. Pure: same inputs,
   same outputs, whether run in the browser for a live projection or in a
   program to settle a claim.
   ========================================================================== */

export interface ProductionInput {
  buildings: readonly (PlacedLike & { id: string })[];
  resources: ResourceBag;
  city: CityStats;
  stats: PlayerStats;
  elapsedSeconds: number;
}

export interface ProductionResult {
  /** Net resources to add. Already clamped to storage. */
  produced: ResourceBag;
  /** Resources burned as fuel or smelter input. */
  consumed: ResourceBag;
  /** New bore depths, keyed by building id. */
  boreDepths: Record<string, number>;
  /** True when output was cut short by a full store — the UI warns about it. */
  storageFull: boolean;
  powerEfficiency: number;
}

export function simulateProduction(input: ProductionInput): ProductionResult {
  const { buildings, resources, city, stats, elapsedSeconds } = input;
  const dt = Math.max(0, elapsedSeconds);

  const produced: ResourceBag = {};
  const consumed: ResourceBag = {};
  const boreDepths: Record<string, number> = {};
  const eff = city.powerEfficiency;

  /* ---- generators burn coal ------------------------------------------- */
  let coalAvailable = resources.coal ?? 0;
  for (const b of buildings) {
    if (b.kind !== "generator") continue;
    const burn = generatorFuelBurn(b.level) * dt;
    const actual = Math.min(coalAvailable, burn);
    coalAvailable -= actual;
    bagAdd(consumed, "coal", Math.floor(actual));
  }

  /* ---- extractors bore downward and pull ore --------------------------- */
  const rateMult = 1 + stats.extractorRate / 100;

  for (const b of buildings) {
    if (b.kind !== "extractor") continue;

    const startDepth = b.boreDepth ?? SURFACE_Y;
    const descent = BORE_RATE_PER_LEVEL * b.level * dt * eff;
    const endDepth = Math.max(1, startDepth - descent);
    boreDepths[b.id] = endDepth;

    // Sample the midpoint of the interval bored during this window. Over a
    // long settlement that's a good approximation and it costs one lookup
    // instead of integrating across every band boundary crossed.
    const sampleY = Math.round((startDepth + endDepth) / 2);
    const mix = oreMixAtDepth(sampleY);
    if (mix.length === 0) continue;

    const density = oreDensityAtDepth(sampleY);
    const totalOre = extractorRate(b.level) * rateMult * eff * density * dt;
    if (totalOre <= 0) continue;

    const weightSum = mix.reduce((n, m) => n + m.weight, 0);
    for (const entry of mix) {
      const qty = Math.floor((totalOre * entry.weight) / weightSum);
      if (qty > 0) bagAdd(produced, entry.kind, qty);
    }
  }

  /* ---- smelters refine, best recipe they can run ----------------------- */
  const refineMult = 1 + stats.refineSpeed / 100;
  // Work against a running copy so two smelters can't spend the same ore.
  const pool: ResourceBag = { ...resources };
  bagAdd(pool, "coal", -(consumed.coal ?? 0));

  for (const b of buildings) {
    if (b.kind !== "smelter") continue;

    // Prefer the most valuable recipe this smelter is licensed for and has
    // input for — players expect a smelter to work on the good stuff first.
    const candidates = RECIPES.filter((r) => r.minSmelterLevel <= b.level)
      .slice()
      .sort((x, y) => RESOURCE_DEFS[y.output].baseValue - RESOURCE_DEFS[x.output].baseValue);

    let budget = dt * eff * refineMult;

    for (const recipe of candidates) {
      if (budget <= 0) break;

      // Solve for the batch count directly rather than looping. A player who
      // leaves for a week settles a very large `dt`, and stepping one batch at
      // a time would run millions of iterations on the main thread.
      const byTime = Math.floor(budget / recipe.seconds);
      if (byTime <= 0) continue;

      const byInput = Math.floor((pool[recipe.input] ?? 0) / recipe.inputQty);
      const byCoal = Math.floor((pool.coal ?? 0) / recipe.coal);
      const batches = Math.min(byTime, byInput, byCoal);
      if (batches <= 0) continue;

      bagSubtract(pool, {
        [recipe.input]: recipe.inputQty * batches,
        coal: recipe.coal * batches,
      });

      budget -= batches * recipe.seconds;
      bagAdd(produced, recipe.output, batches * recipe.outputQty);
      bagAdd(consumed, recipe.input, batches * recipe.inputQty);
      bagAdd(consumed, "coal", batches * recipe.coal);
    }
  }

  /* ---- storage clamp --------------------------------------------------- */
  const currentTotal = sumBag(resources);
  const producedTotal = sumBag(produced);
  const consumedTotal = sumBag(consumed);
  const headroom = Math.max(0, city.storageCap - (currentTotal - consumedTotal));

  let storageFull = false;
  if (producedTotal > headroom) {
    storageFull = true;
    const keepRatio = headroom / producedTotal;
    for (const key of Object.keys(produced) as ResourceKind[]) {
      const kept = Math.floor((produced[key] ?? 0) * keepRatio);
      if (kept > 0) produced[key] = kept;
      else delete produced[key];
    }
  }

  return { produced, consumed, boreDepths, storageFull, powerEfficiency: eff };
}

function sumBag(bag: ResourceBag): number {
  let n = 0;
  for (const v of Object.values(bag)) n += v ?? 0;
  return n;
}

/* ==========================================================================
   Selling
   ========================================================================== */

/**
 * Sale proceeds in whole STRATA.
 *
 * The sink price is fixed by config rather than floating with supply. A
 * dynamic sink price sounds sophisticated and in practice just punishes
 * whoever logs in last; the player marketplace is where price discovery is
 * supposed to happen.
 */
export function saleProceeds(bag: ResourceBag): number {
  let total = 0;
  for (const [kind, qty] of Object.entries(bag) as [ResourceKind, number][]) {
    total += RESOURCE_DEFS[kind].baseValue * (qty ?? 0);
  }
  return Math.floor(total);
}

/** Marketplace fee split, in whole STRATA. */
export function marketFeeSplit(
  price: number,
  feeBps: number,
  burnShareBps: number
): { fee: number; toTreasury: number; toBurn: number; toSeller: number } {
  const fee = Math.floor((price * feeBps) / 10_000);
  const toBurn = Math.floor((fee * burnShareBps) / 10_000);
  return { fee, toTreasury: fee - toBurn, toBurn, toSeller: price - fee };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
