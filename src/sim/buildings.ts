import type { BuildingKind, ResourceBag } from "./types";

/**
 * City buildings.
 *
 * The constraint that makes city layout a real decision is **workers**, not
 * money. Habitats are the only source of them and every other building
 * consumes them, so expanding always means deciding what you're willing to
 * house. Money is a pacing gate; workers are the actual puzzle.
 *
 * Power is the second constraint and it's deliberately softer: running a
 * deficit doesn't break anything, it just scales all production down. Failing
 * a city-builder because you misjudged a generator is not fun.
 */

export interface BuildingDef {
  readonly kind: BuildingKind;
  readonly name: string;
  readonly blurb: string;
  readonly description: string;
  /** Footprint in voxels, [width, depth]. Always odd so it has a centre. */
  readonly footprint: readonly [number, number];
  /** Visual height in voxels. */
  readonly height: number;
  readonly maxLevel: number;
  /** Workers occupied. Habitats are negative — they supply. */
  readonly workers: number;
  /** Energy per second. Negative consumes, positive produces. */
  readonly powerL1: number;
  /** Multiplier applied per level above 1, to cost / output / power. */
  readonly costScale: number;
  readonly outputScale: number;
  readonly baseCostTokens: number;
  readonly baseCostResources: ResourceBag;
  /** Player level required before this can be placed. */
  readonly unlockLevel: number;
  /** Some buildings only make sense once. */
  readonly maxCount: number | null;
  readonly accent: string;
}

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  extractor: {
    kind: "extractor",
    name: "Extractor",
    blurb: "Mines the column beneath it, forever",
    description:
      "Sinks an automated bore straight down and pulls up whatever stratum it reaches. Place it " +
      "over deep ground — an extractor standing on dirt returns dirt-tier ore.",
    footprint: [5, 5],
    height: 7,
    maxLevel: 5,
    workers: 2,
    powerL1: -3,
    costScale: 1.9,
    outputScale: 1.55,
    baseCostTokens: 400,
    baseCostResources: { ironIngot: 4 },
    unlockLevel: 1,
    maxCount: null,
    accent: "#ff9a2e",
  },
  smelter: {
    kind: "smelter",
    name: "Smelter",
    blurb: "Turns raw ore into ingots worth four times as much",
    description:
      "Runs recipes continuously as long as it has input and coal. The single highest-return " +
      "building in the game — selling raw ore is always leaving money underground.",
    footprint: [5, 5],
    height: 8,
    maxLevel: 5,
    workers: 3,
    powerL1: -4,
    costScale: 1.85,
    outputScale: 1.5,
    baseCostTokens: 650,
    baseCostResources: { ironIngot: 6, copperIngot: 2 },
    unlockLevel: 2,
    maxCount: null,
    accent: "#ff6b35",
  },
  generator: {
    kind: "generator",
    name: "Generator",
    blurb: "Burns coal into the power everything else runs on",
    description:
      "Consumes coal at a steady rate and supplies the grid. Every other building draws against " +
      "it; run a deficit and the whole city slows down proportionally.",
    footprint: [5, 5],
    height: 9,
    maxLevel: 5,
    workers: 2,
    powerL1: 14,
    costScale: 1.8,
    outputScale: 1.6,
    baseCostTokens: 500,
    baseCostResources: { copperIngot: 5 },
    unlockLevel: 1,
    maxCount: null,
    accent: "#fbbf24",
  },
  silo: {
    kind: "silo",
    name: "Silo",
    blurb: "Raises the ceiling on what you can hold",
    description:
      "Storage is a hard cap: production stops dead when you're full. Silos are cheap and the " +
      "first thing you should build when extractors start idling.",
    footprint: [3, 3],
    height: 6,
    maxLevel: 5,
    workers: 1,
    powerL1: -1,
    costScale: 1.75,
    outputScale: 1.8,
    baseCostTokens: 220,
    baseCostResources: { ironIngot: 3 },
    unlockLevel: 1,
    maxCount: null,
    accent: "#36d6ec",
  },
  habitat: {
    kind: "habitat",
    name: "Habitat",
    blurb: "Houses the crew every other building needs",
    description:
      "The only source of workers. Nothing else you build matters if there's nobody to run it.",
    footprint: [5, 5],
    height: 6,
    maxLevel: 5,
    workers: -4,
    powerL1: -2,
    costScale: 1.7,
    outputScale: 1,
    baseCostTokens: 300,
    baseCostResources: { ironIngot: 4 },
    unlockLevel: 1,
    maxCount: null,
    accent: "#4ade80",
  },
  market: {
    kind: "market",
    name: "Market Hub",
    blurb: "Opens the player marketplace and cuts your fees",
    description:
      "A landing pad, a scale and a clerk. Required before you can list items, and each level " +
      "shaves basis points off what the marketplace takes from your sales.",
    footprint: [7, 7],
    height: 10,
    maxLevel: 5,
    workers: 4,
    powerL1: -3,
    costScale: 2.0,
    outputScale: 1,
    baseCostTokens: 1_800,
    baseCostResources: { ironIngot: 10, silverIngot: 4 },
    unlockLevel: 3,
    maxCount: 1,
    accent: "#a78bfa",
  },
  lab: {
    kind: "lab",
    name: "Assay Lab",
    blurb: "Improves crate luck and smelter throughput",
    description:
      "Analyses what comes out of the ground and tells the rest of the city what to do with it. " +
      "Luck here stacks with your Scanner, up to the global cap.",
    footprint: [5, 5],
    height: 8,
    maxLevel: 5,
    workers: 3,
    powerL1: -5,
    costScale: 1.95,
    outputScale: 1,
    baseCostTokens: 1_400,
    baseCostResources: { silverIngot: 3, focusedCrystal: 1 },
    unlockLevel: 4,
    maxCount: 1,
    accent: "#56e0d0",
  },
};

export const BUILDING_LIST: readonly BuildingDef[] = Object.values(BUILDING_DEFS);

/* ==========================================================================
   Level scaling
   ========================================================================== */

export function buildingCost(kind: BuildingKind, level: number): {
  tokens: number;
  resources: ResourceBag;
} {
  const def = BUILDING_DEFS[kind];
  const factor = Math.pow(def.costScale, level - 1);
  const resources: ResourceBag = {};
  for (const [k, v] of Object.entries(def.baseCostResources)) {
    resources[k as keyof ResourceBag] = Math.ceil((v ?? 0) * factor);
  }
  return { tokens: Math.ceil(def.baseCostTokens * factor), resources };
}

/** Energy per second at a given level. Negative consumes. */
export function buildingPower(kind: BuildingKind, level: number): number {
  const def = BUILDING_DEFS[kind];
  const factor = Math.pow(def.kind === "generator" ? def.outputScale : 1.35, level - 1);
  return Number((def.powerL1 * factor).toFixed(2));
}

/** Workers occupied at a given level. Habitats return a negative (supply). */
export function buildingWorkers(kind: BuildingKind, level: number): number {
  const def = BUILDING_DEFS[kind];
  if (def.kind === "habitat") return def.workers - (level - 1) * 3;
  return def.workers + Math.floor((level - 1) * 0.5);
}

/** Raw ore per second for an extractor at a level, before modifiers. */
export function extractorRate(level: number): number {
  return Number((0.55 * Math.pow(BUILDING_DEFS.extractor.outputScale, level - 1)).toFixed(3));
}

/** Storage headroom added by a silo. */
export function siloCapacity(level: number): number {
  return Math.round(2_500 * Math.pow(BUILDING_DEFS.silo.outputScale, level - 1));
}

/** Coal burned per second by a generator. */
export function generatorFuelBurn(level: number): number {
  return Number((0.25 * Math.pow(1.4, level - 1)).toFixed(3));
}

/** Marketplace fee discount in basis points from a Market Hub. */
export function marketFeeDiscountBps(level: number): number {
  return level * 20;
}

/** Luck contributed by an Assay Lab, in percentage points. */
export function labLuck(level: number): number {
  return level * 3;
}

/** Refine speed contributed by an Assay Lab, in percent. */
export function labRefineSpeed(level: number): number {
  return level * 5;
}
