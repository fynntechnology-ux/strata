import { BLOCK, IS_SOLID, blockDef } from "./blocks";
import {
  CHUNK,
  CHUNKS_X,
  CHUNKS_Y,
  CHUNKS_Z,
  H,
  VOXEL_COUNT,
  W,
  chunkIndex,
  idx,
  inBounds,
} from "./coords";
import { WorldGen, type GenerationStats } from "./worldgen";

/**
 * The voxel world: storage, edits, queries and raycasting.
 *
 * Owns the authoritative `Uint8Array` and a set of chunks whose meshes are out
 * of date. Nothing in here touches Three.js — the renderer subscribes to the
 * dirty set and rebuilds at its own pace. Keeping the simulation side free of
 * rendering types is what allows the world to be generated and queried in a
 * test, or eventually in a worker, without a canvas.
 */

export interface RaycastHit {
  /** The solid voxel that was hit. */
  x: number;
  y: number;
  z: number;
  /** Face normal, pointing out of the hit block. Used for placement. */
  nx: number;
  ny: number;
  nz: number;
  distance: number;
  blockId: number;
}

export class VoxelWorld {
  readonly data: Uint8Array;
  readonly dirty = new Set<number>();

  #gen: WorldGen | null = null;
  #seed = 0;
  #stamps = new Map<string, Array<{ index: number; previous: number }>>();
  /** Player edits only. Building voxels are excluded — see `stamp`. */
  #edits = new Map<number, number>();

  stats: GenerationStats | null = null;

  constructor() {
    this.data = new Uint8Array(VOXEL_COUNT);
  }

  get seed(): number {
    return this.#seed;
  }

  get generator(): WorldGen | null {
    return this.#gen;
  }

  async generate(
    seed: number,
    onProgress?: (progress: number, label: string) => void
  ): Promise<void> {
    this.#seed = seed;
    this.data.fill(0);
    this.#stamps.clear();
    this.#edits.clear();
    this.#gen = new WorldGen(seed);
    this.stats = await this.#gen.generate(this.data, onProgress);
    this.markAllDirty();
  }

  /* ======================================================================
     Access
     ====================================================================== */

  get(x: number, y: number, z: number): number {
    if (!inBounds(x, y, z)) return BLOCK.AIR;
    return this.data[idx(x, y, z)];
  }

  isSolid(x: number, y: number, z: number): boolean {
    return IS_SOLID[this.get(x, y, z)] === 1;
  }

  set(x: number, y: number, z: number, id: number): boolean {
    if (!inBounds(x, y, z)) return false;
    const at = idx(x, y, z);
    if (this.data[at] === id) return false;
    this.data[at] = id;
    this.#edits.set(at, id);
    this.#markDirtyAround(x, y, z);
    return true;
  }

  /**
   * Marks the containing chunk, plus any neighbour whose mesh depends on this
   * voxel. A block on a chunk face contributes ambient occlusion to the chunk
   * next door, so a one-block edit can dirty up to eight chunks. Skipping this
   * leaves visible seams of stale shadow along chunk borders.
   */
  #markDirtyAround(x: number, y: number, z: number): void {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const cz = Math.floor(z / CHUNK);

    const lx = x % CHUNK;
    const ly = y % CHUNK;
    const lz = z % CHUNK;

    // AO reaches one voxel diagonally, so a voxel sitting on a chunk face also
    // affects the mesh of the chunk across that face.
    const loX = lx === 0 ? -1 : 0;
    const hiX = lx === CHUNK - 1 ? 1 : 0;
    const loY = ly === 0 ? -1 : 0;
    const hiY = ly === CHUNK - 1 ? 1 : 0;
    const loZ = lz === 0 ? -1 : 0;
    const hiZ = lz === CHUNK - 1 ? 1 : 0;

    for (let ix = loX; ix <= hiX; ix++) {
      for (let iy = loY; iy <= hiY; iy++) {
        for (let iz = loZ; iz <= hiZ; iz++) {
          const tx = cx + ix;
          const ty = cy + iy;
          const tz = cz + iz;
          if (tx < 0 || tx >= CHUNKS_X || ty < 0 || ty >= CHUNKS_Y || tz < 0 || tz >= CHUNKS_Z) {
            continue;
          }
          this.dirty.add(chunkIndex(tx, ty, tz));
        }
      }
    }
  }

  markAllDirty(): void {
    for (let i = 0; i < CHUNKS_X * CHUNKS_Y * CHUNKS_Z; i++) this.dirty.add(i);
  }

  /* ======================================================================
     Queries
     ====================================================================== */

  /** Topmost solid voxel in a column, or -1 if the column is empty. */
  surfaceAt(x: number, z: number): number {
    if (x < 0 || x >= W || z < 0 || z >= W) return -1;
    const column = H * (x + W * z);
    for (let y = H - 1; y >= 0; y--) {
      if (IS_SOLID[this.data[column + y]]) return y;
    }
    return -1;
  }

  /** Lowest solid voxel below `fromY` — where an extractor's bore would end. */
  floorBelow(x: number, z: number, fromY: number): number {
    const column = H * (x + W * z);
    for (let y = Math.min(fromY, H - 1); y >= 0; y--) {
      if (IS_SOLID[this.data[column + y]]) return y;
    }
    return -1;
  }

  /**
   * Whether a rectangular footprint can take a building.
   *
   * Rejects anything spanning more than three blocks of height variation.
   * Levelling an arbitrary slope produces ugly floating platforms, and the
   * player has a whole claim to choose from — refusing is kinder than
   * silently producing something that looks broken.
   */
  canPlaceFootprint(
    x: number,
    z: number,
    width: number,
    depth: number
  ): { ok: true; y: number } | { ok: false; reason: string } {
    if (x < 1 || z < 1 || x + width > W - 1 || z + depth > W - 1) {
      return { ok: false, reason: "Outside your claim" };
    }

    let min = Infinity;
    let max = -Infinity;

    for (let dz = 0; dz < depth; dz++) {
      for (let dx = 0; dx < width; dx++) {
        const surface = this.surfaceAt(x + dx, z + dz);
        if (surface < 0) return { ok: false, reason: "No ground here" };
        const block = this.get(x + dx, surface, z + dz);
        if (blockDef(block).hardness === Infinity) {
          return { ok: false, reason: "Can't build on bedrock" };
        }
        if (surface < min) min = surface;
        if (surface > max) max = surface;
      }
    }

    if (max - min > 3) return { ok: false, reason: "Ground is too uneven" };
    return { ok: true, y: max + 1 };
  }

  /* ======================================================================
     Building stamps

     A building is just voxels, so it meshes and lights identically to
     terrain. The undo record is what makes demolition possible without
     regenerating the chunk from noise.
     ====================================================================== */

  stamp(
    id: string,
    blocks: ReadonlyArray<{ x: number; y: number; z: number; block: number }>
  ): void {
    const undo: Array<{ index: number; previous: number }> = [];

    for (const { x, y, z, block } of blocks) {
      if (!inBounds(x, y, z)) continue;
      const at = idx(x, y, z);
      undo.push({ index: at, previous: this.data[at] });
      this.data[at] = block;
      this.#markDirtyAround(x, y, z);
    }

    this.#stamps.set(id, undo);
  }

  unstamp(id: string): boolean {
    const undo = this.#stamps.get(id);
    if (!undo) return false;

    for (let i = undo.length - 1; i >= 0; i--) {
      const { index, previous } = undo[i];
      this.data[index] = previous;
      // Recover coordinates from the index to dirty the right chunks.
      const y = index % H;
      const rest = (index - y) / H;
      const x = rest % W;
      const z = (rest - x) / W;
      this.#markDirtyAround(x, y, z);
    }

    this.#stamps.delete(id);
    return true;
  }

  hasStamp(id: string): boolean {
    return this.#stamps.has(id);
  }

  /* ======================================================================
     Raycasting

     Amanatides & Woo voxel traversal. Stepping the grid directly is both
     exact and far faster than intersecting the chunk meshes — there is no
     geometry to test, just arithmetic, and it cannot miss a block the way a
     triangle raycast can at grazing angles.
     ====================================================================== */

  raycast(
    originX: number,
    originY: number,
    originZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    maxDistance = 128
  ): RaycastHit | null {
    const length = Math.hypot(dirX, dirY, dirZ);
    if (length === 0) return null;

    const dx = dirX / length;
    const dy = dirY / length;
    const dz = dirZ / length;

    let x = Math.floor(originX);
    let y = Math.floor(originY);
    let z = Math.floor(originZ);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    // Distance along the ray between successive crossings of each axis.
    const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
    const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);

    // Distance to the first crossing on each axis.
    let tMaxX =
      stepX === 0 ? Infinity : (stepX > 0 ? x + 1 - originX : originX - x) * tDeltaX;
    let tMaxY =
      stepY === 0 ? Infinity : (stepY > 0 ? y + 1 - originY : originY - y) * tDeltaY;
    let tMaxZ =
      stepZ === 0 ? Infinity : (stepZ > 0 ? z + 1 - originZ : originZ - z) * tDeltaZ;

    let nx = 0;
    let ny = 0;
    let nz = 0;
    let distance = 0;

    // The ray may start outside the world and travel into it, so allow a
    // generous number of steps rather than bailing on the first miss.
    const maxSteps = Math.ceil(maxDistance * 3) + 3;

    for (let step = 0; step < maxSteps; step++) {
      if (inBounds(x, y, z) && IS_SOLID[this.data[idx(x, y, z)]]) {
        return { x, y, z, nx, ny, nz, distance, blockId: this.data[idx(x, y, z)] };
      }

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        distance = tMaxX;
        x += stepX;
        tMaxX += tDeltaX;
        nx = -stepX;
        ny = 0;
        nz = 0;
      } else if (tMaxY < tMaxZ) {
        distance = tMaxY;
        y += stepY;
        tMaxY += tDeltaY;
        nx = 0;
        ny = -stepY;
        nz = 0;
      } else {
        distance = tMaxZ;
        z += stepZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }

      if (distance > maxDistance) return null;

      // Once the ray is past the world on an axis it can never come back.
      if (
        (x < 0 && stepX <= 0) ||
        (x >= W && stepX >= 0) ||
        (y < 0 && stepY <= 0) ||
        (y >= H && stepY >= 0) ||
        (z < 0 && stepZ <= 0) ||
        (z >= W && stepZ >= 0)
      ) {
        return null;
      }
    }

    return null;
  }

  /* ======================================================================
     Serialisation

     A full world is 600KB, well past what localStorage will take, and the
     terrain is a pure function of the seed anyway. So only *edits* are
     persisted: regenerate from the seed, replay the edit log, re-stamp the
     buildings, and the claim is exactly as it was left.

     Edits are recorded as they happen rather than diffed against a
     regenerated world on save. Diffing would mean running worldgen a second
     time and trusting the two runs to agree bit for bit; recording is exact
     by construction and costs one map write per mined block.
     ====================================================================== */

  get editCount(): number {
    return this.#edits.size;
  }

  serializeEdits(): Array<[number, number]> {
    return Array.from(this.#edits.entries());
  }

  applyEdits(edits: ReadonlyArray<readonly [number, number]>): void {
    for (const [index, value] of edits) {
      if (index < 0 || index >= VOXEL_COUNT) continue;
      this.data[index] = value;
      this.#edits.set(index, value);
    }
    this.markAllDirty();
  }
}
