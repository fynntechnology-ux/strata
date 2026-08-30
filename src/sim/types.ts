/**
 * Core game-domain vocabulary.
 *
 * Everything in here is shared by the simulation, the UI and the chain layer.
 * Each enum carries an explicit `u8` discriminant because these values are
 * serialised into on-chain accounts — the numbers are a wire format, so they
 * are append-only. Never renumber an existing variant; add new ones at the end.
 */

/* ==========================================================================
   Rarity
   ========================================================================== */

export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
] as const;

export type Rarity = (typeof RARITIES)[number];

/** Wire encoding. Append-only. */
export const RARITY_U8: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

export const RARITY_META: Record<
  Rarity,
  { label: string; color: string; cssVar: string; tier: number; glow: number }
> = {
  common: { label: "Common", color: "#7c8798", cssVar: "--color-r-common", tier: 0, glow: 0 },
  uncommon: { label: "Uncommon", color: "#4ade80", cssVar: "--color-r-uncommon", tier: 1, glow: 0.15 },
  rare: { label: "Rare", color: "#38bdf8", cssVar: "--color-r-rare", tier: 2, glow: 0.35 },
  epic: { label: "Epic", color: "#a78bfa", cssVar: "--color-r-epic", tier: 3, glow: 0.6 },
  legendary: { label: "Legendary", color: "#fbbf24", cssVar: "--color-r-legendary", tier: 4, glow: 0.85 },
  mythic: { label: "Mythic", color: "#ff6b6b", cssVar: "--color-r-mythic", tier: 5, glow: 1 },
};

/* ==========================================================================
   Resources
   ========================================================================== */

/** Dug straight out of the ground. */
export const RAW_RESOURCES = [
  "coal",
  "iron",
  "copper",
  "silver",
  "titanium",
  "crystal",
  "voidstone",
] as const;

/** Produced by a Smelter from raw input. Worth far more; the main income path. */
export const REFINED_RESOURCES = [
  "ironIngot",
  "copperIngot",
  "silverIngot",
  "titaniumPlate",
  "focusedCrystal",
  "voidCore",
] as const;

export type RawResource = (typeof RAW_RESOURCES)[number];
export type RefinedResource = (typeof REFINED_RESOURCES)[number];
export type ResourceKind = RawResource | RefinedResource;

export const ALL_RESOURCES: readonly ResourceKind[] = [
  ...RAW_RESOURCES,
  ...REFINED_RESOURCES,
];

/** Wire encoding. Append-only. */
export const RESOURCE_U8: Record<ResourceKind, number> = {
  coal: 0,
  iron: 1,
  copper: 2,
  silver: 3,
  titanium: 4,
  crystal: 5,
  voidstone: 6,
  ironIngot: 7,
  copperIngot: 8,
  silverIngot: 9,
  titaniumPlate: 10,
  focusedCrystal: 11,
  voidCore: 12,
};

export interface ResourceDef {
  readonly kind: ResourceKind;
  readonly label: string;
  /** Hex colour, shared between the voxel palette and UI chips. */
  readonly color: string;
  readonly tier: number;
  /** Base sale value in whole STRATA (pre-multiplier). */
  readonly baseValue: number;
  readonly refined: boolean;
  readonly description: string;
}

export type ResourceBag = Partial<Record<ResourceKind, number>>;

/* ==========================================================================
   Equipment
   ========================================================================== */

export const ITEM_SLOTS = ["pick", "drill", "cell", "scanner", "frame"] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

export const ITEM_SLOT_U8: Record<ItemSlot, number> = {
  pick: 0,
  drill: 1,
  cell: 2,
  scanner: 3,
  frame: 4,
};

export const ITEM_SLOT_META: Record<
  ItemSlot,
  { label: string; blurb: string; icon: string }
> = {
  pick: { label: "Pick", blurb: "Hand-mining speed and the hardness you can break", icon: "pick" },
  drill: { label: "Drill Core", blurb: "Output rate of every Extractor in your city", icon: "drill" },
  cell: { label: "Power Cell", blurb: "Energy capacity and recharge rate", icon: "cell" },
  scanner: { label: "Scanner", blurb: "Reveals buried ore and improves crate luck", icon: "scanner" },
  frame: { label: "Exo-Frame", blurb: "Cuts the energy cost of every swing", icon: "frame" },
};

/**
 * Stats an item can roll. Values are additive percentage points unless noted;
 * they are stored on-chain as `i16` basis-point-ish integers, never floats.
 */
export const STAT_KEYS = [
  "miningSpeed",
  "yieldBonus",
  "energyMax",
  "energyRegen",
  "energyCost",
  "extractorRate",
  "luck",
  "refineSpeed",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type StatBlock = Partial<Record<StatKey, number>>;

export const STAT_META: Record<
  StatKey,
  { label: string; unit: "%" | "flat"; good: "up" | "down" }
> = {
  miningSpeed: { label: "Mining Speed", unit: "%", good: "up" },
  yieldBonus: { label: "Yield", unit: "%", good: "up" },
  energyMax: { label: "Max Energy", unit: "flat", good: "up" },
  energyRegen: { label: "Energy Regen", unit: "%", good: "up" },
  energyCost: { label: "Energy Cost", unit: "%", good: "down" },
  extractorRate: { label: "Extractor Rate", unit: "%", good: "up" },
  luck: { label: "Luck", unit: "%", good: "up" },
  refineSpeed: { label: "Refine Speed", unit: "%", good: "up" },
};

/* ==========================================================================
   Buildings
   ========================================================================== */

export const BUILDING_KINDS = [
  "extractor",
  "smelter",
  "generator",
  "silo",
  "habitat",
  "market",
  "lab",
] as const;

export type BuildingKind = (typeof BUILDING_KINDS)[number];

export const BUILDING_U8: Record<BuildingKind, number> = {
  extractor: 0,
  smelter: 1,
  generator: 2,
  silo: 3,
  habitat: 4,
  market: 5,
  lab: 6,
};

/* ==========================================================================
   Packs
   ========================================================================== */

export const PACK_KINDS = ["supply", "prospector", "deepcore"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const PACK_U8: Record<PackKind, number> = {
  supply: 0,
  prospector: 1,
  deepcore: 2,
};
