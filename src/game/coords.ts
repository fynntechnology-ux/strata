import { WORLD_HEIGHT, WORLD_SIZE_XZ } from "@/sim/strata";

/**
 * World storage layout.
 *
 * The claim is bounded, so the whole thing is one flat `Uint8Array` rather
 * than a hash map of chunks. That removes every chunk-boundary special case
 * from the mesher and the raycaster — a neighbour lookup is a bounds check and
 * an array read, with no "which chunk owns this?" indirection.
 *
 * Index order is **y-major-contiguous**: `y + H * (x + W * z)`.
 *
 * Vertical runs being contiguous is the right trade here. Worldgen fills
 * column by column, extractors bore straight down, and the raycaster spends
 * most of its steps travelling vertically into the ground. Meshing reads in
 * 16-long vertical runs, which still sits comfortably inside a cache line's
 * worth of useful work.
 */

export const W = WORLD_SIZE_XZ;
export const H = WORLD_HEIGHT;
export const CHUNK = 16;

export const CHUNKS_X = Math.ceil(W / CHUNK);
export const CHUNKS_Y = Math.ceil(H / CHUNK);
export const CHUNKS_Z = Math.ceil(W / CHUNK);
export const CHUNK_COUNT = CHUNKS_X * CHUNKS_Y * CHUNKS_Z;

export const VOXEL_COUNT = W * H * W;

/** Stride constants, hoisted so hot loops can add instead of multiplying. */
export const STRIDE_Y = 1;
export const STRIDE_X = H;
export const STRIDE_Z = H * W;

export function idx(x: number, y: number, z: number): number {
  return y + H * (x + W * z);
}

export function inBounds(x: number, y: number, z: number): boolean {
  return x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < W;
}

export function chunkIndex(cx: number, cy: number, cz: number): number {
  return cx + CHUNKS_X * (cy + CHUNKS_Y * cz);
}

export function chunkOfVoxel(x: number, y: number, z: number): number {
  return chunkIndex(
    Math.floor(x / CHUNK),
    Math.floor(y / CHUNK),
    Math.floor(z / CHUNK)
  );
}

export function chunkOrigin(index: number): [number, number, number] {
  const cx = index % CHUNKS_X;
  const cy = Math.floor(index / CHUNKS_X) % CHUNKS_Y;
  const cz = Math.floor(index / (CHUNKS_X * CHUNKS_Y));
  return [cx * CHUNK, cy * CHUNK, cz * CHUNK];
}

/** World centre in voxel coordinates — the camera's default focus. */
export const CENTER_X = Math.floor(W / 2);
export const CENTER_Z = Math.floor(W / 2);
