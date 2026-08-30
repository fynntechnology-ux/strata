import { createNoise2D, createNoise3D, type NoiseFunction2D, type NoiseFunction3D } from "simplex-noise";
import { Rng } from "@/lib/rng";
import { TimeSlice } from "@/lib/schedule";
import { BEDROCK_Y, STRATA, SURFACE_Y, type StratumBand } from "@/sim/strata";
import { BLOCK, ORE_BY_RESOURCE, type BlockId } from "./blocks";
import { H, W, idx } from "./coords";

/**
 * Terrain generation.
 *
 * The whole claim is derived from one 32-bit seed, which is itself derived
 * from the player's wallet address. Same wallet, same ground, forever — and
 * the same terrain the on-chain program would derive if it ever needed to
 * validate where a building was placed.
 *
 * Generation is deliberately incremental. Filling 600k voxels with several
 * noise lookups each takes long enough to drop frames, so `generate` yields
 * between slabs and reports progress rather than freezing the tab.
 */

export interface GenerationStats {
  surfaceMin: number;
  surfaceMax: number;
  oreCounts: Record<string, number>;
  caveVoxels: number;
}

export class WorldGen {
  readonly seed: number;

  #height: NoiseFunction2D;
  #detail: NoiseFunction2D;
  #cave: NoiseFunction3D;
  #cave2: NoiseFunction3D;
  #scatter: NoiseFunction3D;

  /**
   * Flattened band data, resolved once.
   *
   * The generator visits ~450,000 solid voxels and tests every ore in the
   * band at each one. Anything allocated in that loop — a template string for
   * a Map key, a closure, an intermediate object — costs more than the noise
   * evaluation it was looking up. So the noise functions, block ids and
   * thresholds are all hoisted into plain arrays here, and `#bandForY` turns
   * the band search into a single array index.
   */
  #bands: Array<{
    baseBlock: BlockId;
    oreCount: number;
    oreBlocks: Int32Array;
    oreFreq: Float64Array;
    oreThreshold: Float64Array;
    oreNoise: NoiseFunction3D[];
  }>;
  #bandForY: Uint8Array;

  /** Cached surface height per (x,z) column, filled during generation. */
  readonly heightMap: Int16Array;

  constructor(seed: number) {
    this.seed = seed;
    const rng = new Rng(seed);
    const random = () => rng.float();

    this.#height = createNoise2D(random);
    this.#detail = createNoise2D(random);
    this.#cave = createNoise3D(random);
    this.#cave2 = createNoise3D(random);
    this.#scatter = createNoise3D(random);

    // One independent noise field per ore per band, so veins of different
    // ores don't all sit in the same places with different thresholds.
    this.#bands = STRATA.map((band) => ({
      baseBlock: baseBlockOf(band),
      oreCount: band.ores.length,
      oreBlocks: Int32Array.from(band.ores.map((ore) => ORE_BY_RESOURCE[ore.kind])),
      oreFreq: Float64Array.from(band.ores.map((ore) => ore.freq)),
      oreThreshold: Float64Array.from(band.ores.map((ore) => ore.threshold)),
      oreNoise: band.ores.map(() => createNoise3D(random)),
    }));

    // y -> band index. Saves a linear scan of STRATA at every single voxel.
    this.#bandForY = new Uint8Array(H);
    for (let y = 0; y < H; y++) {
      let index = STRATA.length - 1;
      for (let i = 0; i < STRATA.length; i++) {
        if (y <= STRATA[i].topY && y >= STRATA[i].bottomY) {
          index = i;
          break;
        }
      }
      this.#bandForY[y] = index;
    }

    this.heightMap = new Int16Array(W * W);
  }

  /* ======================================================================
     Surface
     ====================================================================== */

  /**
   * Fractal Brownian motion — three octaves at halving amplitude.
   *
   * Kept shallow on purpose. A mining city needs buildable ground; dramatic
   * mountains look good in a screenshot and are miserable to place a 7×7
   * Market Hub on.
   */
  surfaceAt(x: number, z: number): number {
    let amplitude = 1;
    let frequency = 0.012;
    let sum = 0;
    let norm = 0;

    for (let octave = 0; octave < 3; octave++) {
      sum += this.#height(x * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }

    const base = sum / norm;
    const detail = this.#detail(x * 0.08, z * 0.08) * 0.7;

    // Flatten toward the centre so the starting area is always buildable.
    const dx = (x - W / 2) / (W / 2);
    const dz = (z - W / 2) / (W / 2);
    const edgeBias = Math.min(1, Math.sqrt(dx * dx + dz * dz));
    const relief = 3.2 + edgeBias * 4.5;

    return Math.round(SURFACE_Y + base * relief + detail);
  }

  /* ======================================================================
     Ore and caves
     ====================================================================== */

  #oreAt(bandIndex: number, x: number, y: number, z: number): number {
    const band = this.#bands[bandIndex];

    // Rarest first: a voidstone vein should never be masked by the titanium
    // field it overlaps with.
    for (let i = band.oreCount - 1; i >= 0; i--) {
      const freq = band.oreFreq[i];
      const value = band.oreNoise[i](x * freq, y * freq * 1.35, z * freq);
      // Simplex is roughly [-1,1]; thresholds are written against [0,1].
      if ((value + 1) * 0.5 > band.oreThreshold[i]) {
        return band.oreBlocks[i];
      }
    }
    return 0;
  }

  /**
   * Tunnel carving.
   *
   * Two independent noise fields both near zero produces long, connected
   * tunnels rather than the spherical bubbles a single threshold gives. Caves
   * matter here because they expose ore faces without any digging, which is
   * what makes the first descent feel like exploring instead of grinding.
   */
  #isCave(x: number, y: number, z: number): boolean {
    if (y > SURFACE_Y - 12 || y < BEDROCK_Y + 3) return false;

    const a = this.#cave(x * 0.045, y * 0.075, z * 0.045);
    const b = this.#cave2(x * 0.045, y * 0.075, z * 0.045);

    // Narrow the tunnels with depth so the deep strata stay mostly solid.
    const width = y > 30 ? 0.085 : 0.055;
    return Math.abs(a) < width && Math.abs(b) < width;
  }

  /* ======================================================================
     Generation
     ====================================================================== */

  /**
   * Fills `data` in slabs, yielding between them.
   *
   * `onProgress` is called with 0-1 so the loading screen can show real
   * progress instead of an indeterminate spinner that lies about how long
   * this takes on a slow machine.
   */
  async generate(
    data: Uint8Array,
    onProgress?: (progress: number, label: string) => void
  ): Promise<GenerationStats> {
    const stats: GenerationStats = {
      surfaceMin: H,
      surfaceMax: 0,
      oreCounts: {},
      caveVoxels: 0,
    };

    const SLAB = 4; // columns of z per progress step
    const slice = new TimeSlice(14);

    for (let z0 = 0; z0 < W; z0 += SLAB) {
      const z1 = Math.min(W, z0 + SLAB);

      for (let z = z0; z < z1; z++) {
        for (let x = 0; x < W; x++) {
          const surface = this.surfaceAt(x, z);
          this.heightMap[x + W * z] = surface;
          if (surface < stats.surfaceMin) stats.surfaceMin = surface;
          if (surface > stats.surfaceMax) stats.surfaceMax = surface;

          const base = idx(x, 0, z);

          for (let y = 0; y <= surface && y < H; y++) {
            if (y <= BEDROCK_Y) {
              // Jagged bedrock ceiling so the floor doesn't read as a plane.
              const jag = this.#scatter(x * 0.4, y * 0.4, z * 0.4);
              data[base + y] = y < BEDROCK_Y || jag > -0.15 ? BLOCK.BEDROCK : BLOCK.BASALT;
              continue;
            }

            // Carve before prospecting: a voxel that ends up as air never
            // needed an ore lookup, and ore lookups are the expensive part.
            if (this.#isCave(x, y, z)) {
              data[base + y] = BLOCK.AIR;
              stats.caveVoxels++;
              continue;
            }

            if (y === surface) {
              data[base + y] = surface > SURFACE_Y + 4 ? BLOCK.GRAVEL : BLOCK.GRASS;
              continue;
            }

            if (y > surface - 4) {
              data[base + y] = BLOCK.DIRT;
              continue;
            }

            const bandIndex = this.#bandForY[y];
            const ore = this.#oreAt(bandIndex, x, y, z);

            if (ore !== 0) {
              data[base + y] = ore;
              stats.oreCounts[ore] = (stats.oreCounts[ore] ?? 0) + 1;
            } else if (this.#scatter(x * 0.22, y * 0.22, z * 0.22) > 0.72) {
              data[base + y] = BLOCK.GRAVEL;
            } else {
              data[base + y] = this.#bands[bandIndex].baseBlock;
            }
          }
        }
      }

      onProgress?.(z1 / W, "Surveying strata");
      // Hand control back so the loading bar paints — and so a backgrounded
      // tab still finishes rather than freezing mid-generation.
      await slice.maybeYield();
    }

    this.#placeClaimMarkers(data);
    onProgress?.(1, "Claim registered");

    return stats;
  }

  /**
   * Four corner pylons.
   *
   * Without them the plot edge reads as "the world ran out" rather than "this
   * is the land you own", which is a surprisingly large difference in how the
   * space feels.
   */
  #placeClaimMarkers(data: Uint8Array): void {
    const corners: Array<[number, number]> = [
      [1, 1],
      [W - 2, 1],
      [1, W - 2],
      [W - 2, W - 2],
    ];

    for (const [x, z] of corners) {
      const surface = this.heightMap[x + W * z];
      for (let y = surface + 1; y <= Math.min(H - 1, surface + 7); y++) {
        data[idx(x, y, z)] = y === Math.min(H - 1, surface + 7) ? BLOCK.MARKER : BLOCK.STEEL_DARK;
      }
    }
  }
}

/* ==========================================================================
   Helpers
   ========================================================================== */

function baseBlockOf(band: StratumBand): BlockId {
  switch (band.baseBlock) {
    case "dirt":
      return BLOCK.DIRT;
    case "stone":
      return BLOCK.STONE;
    case "deepslate":
      return BLOCK.DEEPSLATE;
    case "basalt":
      return BLOCK.BASALT;
    case "bedrock":
      return BLOCK.BEDROCK;
  }
}

