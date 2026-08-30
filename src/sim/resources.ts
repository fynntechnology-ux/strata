import type { RawResource, RefinedResource, ResourceBag, ResourceDef, ResourceKind } from "./types";

/**
 * The resource ladder.
 *
 * Two design rules hold this together:
 *
 *  1. **Refining roughly quadruples value.** Selling raw ore is always the
 *     worst thing you can do with it. That gives the Smelter a reason to exist
 *     and makes "build infrastructure" strictly better than "sell everything",
 *     which is what keeps a city-builder from collapsing into a click-farm.
 *
 *  2. **Depth gates value, not grind.** Each tier lives deeper in the strata.
 *     You don't get titanium by mining more iron; you get it by sinking a
 *     deeper shaft, which costs energy and equipment. Progression is vertical.
 */

export const RESOURCE_DEFS: Record<ResourceKind, ResourceDef> = {
  /* ---- raw --------------------------------------------------------------- */
  coal: {
    kind: "coal",
    label: "Coal",
    color: "#3c4250",
    tier: 0,
    baseValue: 1,
    refined: false,
    description: "Burns hot. Every smelter recipe needs it, so it never stops being useful.",
  },
  iron: {
    kind: "iron",
    label: "Iron Ore",
    color: "#c98a68",
    tier: 1,
    baseValue: 3,
    refined: false,
    description: "The backbone of construction. Common through the upper stone layers.",
  },
  copper: {
    kind: "copper",
    label: "Copper Ore",
    color: "#e07a4a",
    tier: 1,
    baseValue: 4,
    refined: false,
    description: "Conductive. Generators and power cells are built out of it.",
  },
  silver: {
    kind: "silver",
    label: "Silver Ore",
    color: "#cdd7e3",
    tier: 2,
    baseValue: 9,
    refined: false,
    description: "Found in thin seams where stone gives way to deepslate.",
  },
  titanium: {
    kind: "titanium",
    label: "Titanium Ore",
    color: "#8fb8d8",
    tier: 3,
    baseValue: 22,
    refined: false,
    description: "Light and stubborn. Needs a hardened pick to break at all.",
  },
  crystal: {
    kind: "crystal",
    label: "Raw Crystal",
    color: "#56e0d0",
    tier: 4,
    baseValue: 55,
    refined: false,
    description: "Grows in basalt pockets. Hums faintly when a scanner passes over it.",
  },
  voidstone: {
    kind: "voidstone",
    label: "Voidstone",
    color: "#b07ae8",
    tier: 5,
    baseValue: 140,
    refined: false,
    description: "Only the deepest bedrock margin carries it. Nobody agrees on what it is.",
  },

  /* ---- refined ----------------------------------------------------------- */
  // Each refined value is ~4x the raw input it consumes (3 ore + coal), which
  // is the "refining roughly quadruples value" claim the design rests on.
  // `economy.test.ts` asserts the ratio, so these can't quietly drift apart.
  ironIngot: {
    kind: "ironIngot",
    label: "Iron Ingot",
    color: "#d79b78",
    tier: 1,
    baseValue: 38,
    refined: true,
    description: "Three ore and a lump of coal. The first real profit you'll make.",
  },
  copperIngot: {
    kind: "copperIngot",
    label: "Copper Ingot",
    color: "#f08d5a",
    tier: 1,
    baseValue: 50,
    refined: true,
    description: "Drawn into wire for generators and cells.",
  },
  silverIngot: {
    kind: "silverIngot",
    label: "Silver Ingot",
    color: "#e2eaf4",
    tier: 2,
    baseValue: 112,
    refined: true,
    description: "Mirror-bright. Scanner optics are ground from it.",
  },
  titaniumPlate: {
    kind: "titaniumPlate",
    label: "Titanium Plate",
    color: "#a5cbe8",
    tier: 3,
    baseValue: 265,
    refined: true,
    description: "Rolled under pressure. Exo-frames are plated with it.",
  },
  focusedCrystal: {
    kind: "focusedCrystal",
    label: "Focused Crystal",
    color: "#6ef0e0",
    tier: 4,
    baseValue: 650,
    refined: true,
    description: "Cut along its resonance axis. Doubles as a lab reagent.",
  },
  voidCore: {
    kind: "voidCore",
    label: "Void Core",
    color: "#c48ef5",
    tier: 5,
    baseValue: 1_650,
    refined: true,
    description: "Stable, barely. The only input the deepest extractors accept.",
  },
};

/* ==========================================================================
   Refining
   ========================================================================== */

export interface Recipe {
  readonly output: RefinedResource;
  readonly outputQty: number;
  readonly input: RawResource;
  readonly inputQty: number;
  readonly coal: number;
  /** Seconds at Smelter level 1, before any speed modifiers. */
  readonly seconds: number;
  /** Smelter level required to unlock. */
  readonly minSmelterLevel: number;
}

export const RECIPES: readonly Recipe[] = [
  { output: "ironIngot", outputQty: 1, input: "iron", inputQty: 3, coal: 1, seconds: 8, minSmelterLevel: 1 },
  { output: "copperIngot", outputQty: 1, input: "copper", inputQty: 3, coal: 1, seconds: 9, minSmelterLevel: 1 },
  { output: "silverIngot", outputQty: 1, input: "silver", inputQty: 3, coal: 2, seconds: 16, minSmelterLevel: 2 },
  { output: "titaniumPlate", outputQty: 1, input: "titanium", inputQty: 3, coal: 3, seconds: 28, minSmelterLevel: 3 },
  { output: "focusedCrystal", outputQty: 1, input: "crystal", inputQty: 3, coal: 4, seconds: 45, minSmelterLevel: 4 },
  { output: "voidCore", outputQty: 1, input: "voidstone", inputQty: 3, coal: 6, seconds: 80, minSmelterLevel: 5 },
];

export const RECIPE_BY_OUTPUT = new Map(RECIPES.map((r) => [r.output, r]));
export const RECIPE_BY_INPUT = new Map(RECIPES.map((r) => [r.input, r]));

/* ==========================================================================
   Bag helpers

   `ResourceBag` is a sparse partial record. Every operation on it has to
   tolerate missing keys, so all mutation goes through these rather than
   ad-hoc `bag[k] += n` at call sites.
   ========================================================================== */

export function emptyBag(): ResourceBag {
  return {};
}

export function bagAdd(target: ResourceBag, kind: ResourceKind, qty: number): ResourceBag {
  if (qty === 0) return target;
  target[kind] = (target[kind] ?? 0) + qty;
  if ((target[kind] ?? 0) <= 0) delete target[kind];
  return target;
}

export function bagMerge(a: ResourceBag, b: ResourceBag): ResourceBag {
  const out: ResourceBag = { ...a };
  for (const [k, v] of Object.entries(b) as [ResourceKind, number][]) {
    bagAdd(out, k, v);
  }
  return out;
}

export function bagScale(bag: ResourceBag, factor: number): ResourceBag {
  const out: ResourceBag = {};
  for (const [k, v] of Object.entries(bag) as [ResourceKind, number][]) {
    const scaled = Math.floor(v * factor);
    if (scaled > 0) out[k] = scaled;
  }
  return out;
}

export function bagTotal(bag: ResourceBag): number {
  let n = 0;
  for (const v of Object.values(bag)) n += v ?? 0;
  return n;
}

export function bagIsEmpty(bag: ResourceBag): boolean {
  return bagTotal(bag) === 0;
}

/** True when `bag` contains at least everything in `cost`. */
export function bagCovers(bag: ResourceBag, cost: ResourceBag): boolean {
  for (const [k, v] of Object.entries(cost) as [ResourceKind, number][]) {
    if ((bag[k] ?? 0) < (v ?? 0)) return false;
  }
  return true;
}

/** Subtracts `cost` from `bag` in place. Caller must check `bagCovers` first. */
export function bagSubtract(bag: ResourceBag, cost: ResourceBag): ResourceBag {
  for (const [k, v] of Object.entries(cost) as [ResourceKind, number][]) {
    bagAdd(bag, k, -(v ?? 0));
  }
  return bag;
}

/** Sorted entries, highest tier first — the order the inventory renders in. */
export function bagEntries(bag: ResourceBag): Array<[ResourceKind, number]> {
  return (Object.entries(bag) as Array<[ResourceKind, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => {
      const da = RESOURCE_DEFS[a[0]];
      const db = RESOURCE_DEFS[b[0]];
      if (da.refined !== db.refined) return da.refined ? -1 : 1;
      return db.tier - da.tier;
    });
}

/** Total sale value of a bag in whole STRATA, before market modifiers. */
export function bagValue(bag: ResourceBag): number {
  let total = 0;
  for (const [k, v] of Object.entries(bag) as [ResourceKind, number][]) {
    total += RESOURCE_DEFS[k].baseValue * (v ?? 0);
  }
  return total;
}
