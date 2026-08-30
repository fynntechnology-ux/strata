import type { RawResource } from "./types";

/**
 * The layer cake the whole game is named after.
 *
 * This table is the single source of truth for what is where underground.
 * Two very different consumers read it:
 *
 *   - `game/worldgen.ts` uses `freq` / `threshold` to decide, per voxel,
 *     whether an ore is present — that produces the actual visible veins.
 *   - `sim/economy.ts` uses `weight` to decide what an automated Extractor
 *     pulls up from a given bore depth, without simulating individual voxels.
 *
 * Keeping both in one table is what stops the two from drifting — an
 * extractor at y=20 yields roughly what you'd get hand-mining at y=20.
 */

export const WORLD_SIZE_XZ = 80;
export const WORLD_HEIGHT = 96;
/** Average ground level. Terrain noise moves the real surface a few blocks either way. */
export const SURFACE_Y = 62;
export const BEDROCK_Y = 3;

export interface OreSpec {
  readonly kind: RawResource;
  /** Relative abundance within this band, for extractor output. */
  readonly weight: number;
  /** Noise frequency for vein generation. Lower = larger, blobbier veins. */
  readonly freq: number;
  /** Noise value above which the ore replaces the base block. Higher = rarer. */
  readonly threshold: number;
}

export interface StratumBand {
  readonly name: string;
  /** Inclusive top of the band. */
  readonly topY: number;
  /** Inclusive bottom of the band. */
  readonly bottomY: number;
  /** Block id filled when no ore wins. Resolved in `game/blocks.ts`. */
  readonly baseBlock: "dirt" | "stone" | "deepslate" | "basalt" | "bedrock";
  /** Hardness multiplier applied to hand mining in this band. */
  readonly hardness: number;
  readonly ores: readonly OreSpec[];
  readonly tint: string;
}

export const STRATA: readonly StratumBand[] = [
  {
    name: "Topsoil",
    topY: SURFACE_Y,
    bottomY: SURFACE_Y - 4,
    baseBlock: "dirt",
    hardness: 0.5,
    ores: [],
    tint: "#6b5433",
  },
  {
    name: "Upper Stone",
    topY: SURFACE_Y - 5,
    bottomY: 34,
    baseBlock: "stone",
    hardness: 1,
    ores: [
      { kind: "coal", weight: 46, freq: 0.085, threshold: 0.56 },
      { kind: "iron", weight: 34, freq: 0.1, threshold: 0.63 },
      { kind: "copper", weight: 20, freq: 0.105, threshold: 0.68 },
    ],
    tint: "#5c6472",
  },
  {
    name: "Deepslate",
    topY: 33,
    bottomY: 16,
    baseBlock: "deepslate",
    hardness: 1.9,
    ores: [
      { kind: "coal", weight: 14, freq: 0.09, threshold: 0.66 },
      { kind: "iron", weight: 26, freq: 0.1, threshold: 0.6 },
      { kind: "copper", weight: 22, freq: 0.105, threshold: 0.63 },
      { kind: "silver", weight: 27, freq: 0.115, threshold: 0.7 },
      { kind: "titanium", weight: 11, freq: 0.13, threshold: 0.79 },
    ],
    tint: "#333a49",
  },
  {
    name: "Basalt Margin",
    topY: 15,
    bottomY: BEDROCK_Y + 1,
    baseBlock: "basalt",
    hardness: 3.1,
    ores: [
      { kind: "silver", weight: 12, freq: 0.115, threshold: 0.74 },
      { kind: "titanium", weight: 32, freq: 0.12, threshold: 0.68 },
      { kind: "crystal", weight: 39, freq: 0.14, threshold: 0.74 },
      { kind: "voidstone", weight: 17, freq: 0.16, threshold: 0.845 },
    ],
    tint: "#241f2e",
  },
  {
    name: "Bedrock",
    topY: BEDROCK_Y,
    bottomY: 0,
    baseBlock: "bedrock",
    hardness: Infinity,
    ores: [],
    tint: "#12141a",
  },
];

/** The band containing a given y. Clamps rather than returning undefined. */
export function bandAt(y: number): StratumBand {
  for (const band of STRATA) {
    if (y <= band.topY && y >= band.bottomY) return band;
  }
  return y > SURFACE_Y ? STRATA[0] : STRATA[STRATA.length - 1];
}

/**
 * Weighted ore mix an Extractor pulls from a bore depth.
 *
 * Includes a "nothing" share so shallow extractors are genuinely worse than
 * deep ones — otherwise there'd be no reason to ever let a bore run.
 */
export function oreMixAtDepth(y: number): Array<{ kind: RawResource; weight: number }> {
  const band = bandAt(y);
  if (band.ores.length === 0) return [];
  return band.ores.map((o) => ({ kind: o.kind, weight: o.weight }));
}

/** Fraction of extractor ticks that return ore rather than spoil, by depth. */
export function oreDensityAtDepth(y: number): number {
  const band = bandAt(y);
  if (band.ores.length === 0) return 0;
  if (band.baseBlock === "stone") return 0.55;
  if (band.baseBlock === "deepslate") return 0.7;
  if (band.baseBlock === "basalt") return 0.82;
  return 0;
}

/** Human label for the depth readout in the HUD. */
export function depthLabel(y: number): string {
  const band = bandAt(y);
  const metres = Math.max(0, SURFACE_Y - y);
  return `${band.name} · ${metres}m`;
}
