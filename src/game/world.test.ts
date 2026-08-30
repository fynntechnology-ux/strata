import { beforeAll, describe, expect, it } from "vitest";
import { BEDROCK_Y, SURFACE_Y } from "@/sim/strata";
import { BLOCK, IS_ORE, IS_SOLID } from "./blocks";
import { CHUNK, H, W, chunkIndex, idx } from "./coords";
import { meshChunk } from "./mesher";
import { VoxelWorld } from "./world";

/**
 * Engine-level tests.
 *
 * These exist because the voxel engine has no visual regression net: a broken
 * winding order or an off-by-one in the AO offsets produces a world that still
 * renders, just wrongly. Asserting on the generated buffers catches that in a
 * second instead of after a deploy.
 */

const SEED_A = 0x1234_5678;
const SEED_B = 0x8765_4321;

let world: VoxelWorld;

beforeAll(async () => {
  world = new VoxelWorld();
  await world.generate(SEED_A);
}, 30_000);

describe("world generation", () => {
  it("is fully determined by the seed", async () => {
    const twin = new VoxelWorld();
    await twin.generate(SEED_A);
    expect(Buffer.from(twin.data)).toEqual(Buffer.from(world.data));
  }, 30_000);

  it("produces a different world from a different seed", async () => {
    const other = new VoxelWorld();
    await other.generate(SEED_B);
    expect(Buffer.from(other.data)).not.toEqual(Buffer.from(world.data));
  }, 30_000);

  it("puts bedrock at the bottom of every column", () => {
    for (let z = 0; z < W; z += 7) {
      for (let x = 0; x < W; x += 7) {
        expect(world.get(x, 0, z)).toBe(BLOCK.BEDROCK);
      }
    }
  });

  it("leaves air above the surface", () => {
    for (let z = 0; z < W; z += 5) {
      for (let x = 0; x < W; x += 5) {
        const surface = world.surfaceAt(x, z);
        expect(surface).toBeGreaterThan(BEDROCK_Y);
        expect(surface).toBeLessThan(H);
        expect(IS_SOLID[world.get(x, surface + 1, z)]).toBe(0);
      }
    }
  });

  it("keeps the surface within a buildable band around sea level", () => {
    let min = H;
    let max = 0;
    for (let z = 0; z < W; z++) {
      for (let x = 0; x < W; x++) {
        const surface = world.surfaceAt(x, z);
        // Claim marker pylons sit above the terrain; ignore those columns.
        if (world.get(x, surface, z) === BLOCK.MARKER) continue;
        min = Math.min(min, surface);
        max = Math.max(max, surface);
      }
    }
    expect(min).toBeGreaterThan(SURFACE_Y - 18);
    expect(max).toBeLessThan(SURFACE_Y + 18);
  });

  it("generates every ore type somewhere in the claim", () => {
    const found = new Set<number>();
    for (let i = 0; i < world.data.length; i++) {
      if (IS_ORE[world.data[i]]) found.add(world.data[i]);
    }
    expect(found).toContain(BLOCK.COAL_ORE);
    expect(found).toContain(BLOCK.IRON_ORE);
    expect(found).toContain(BLOCK.COPPER_ORE);
    expect(found).toContain(BLOCK.SILVER_ORE);
    expect(found).toContain(BLOCK.TITANIUM_ORE);
    expect(found).toContain(BLOCK.CRYSTAL_ORE);
    expect(found).toContain(BLOCK.VOID_ORE);
  });

  it("keeps ore a minority of the rock", () => {
    // Both bounds matter. Too little and the claim is a boring grey box; too
    // much and the exposed cross-section reads as solid ore, which both looks
    // wrong and makes every resource feel worthless.
    let ore = 0;
    let solid = 0;
    for (let i = 0; i < world.data.length; i++) {
      if (IS_SOLID[world.data[i]]) solid++;
      if (IS_ORE[world.data[i]]) ore++;
    }
    const fraction = ore / solid;
    expect(fraction).toBeGreaterThan(0.02);
    expect(fraction).toBeLessThan(0.2);
  });

  it("keeps the rarest ore genuinely rare", () => {
    let void_ = 0;
    let coal = 0;
    for (let i = 0; i < world.data.length; i++) {
      if (world.data[i] === BLOCK.VOID_ORE) void_++;
      else if (world.data[i] === BLOCK.COAL_ORE) coal++;
    }
    expect(void_).toBeGreaterThan(0);
    expect(void_).toBeLessThan(coal);
  });
});

/* ==========================================================================
   Meshing
   ========================================================================== */

describe("mesher", () => {
  it("emits no geometry for a chunk of pure air", () => {
    // The top chunk layer is well above any terrain.
    const top = chunkIndex(2, Math.floor((H - 1) / CHUNK), 2);
    const empty = new Uint8Array(world.data.length);
    expect(meshChunk(empty, top)).toBeNull();
  });

  it("emits well-formed indexed geometry for a surface chunk", () => {
    const surface = world.surfaceAt(40, 40);
    const mesh = meshChunk(
      world.data,
      chunkIndex(Math.floor(40 / CHUNK), Math.floor(surface / CHUNK), Math.floor(40 / CHUNK))
    );

    expect(mesh).not.toBeNull();
    if (!mesh) return;

    // Four vertices and six indices per quad.
    expect(mesh.vertexCount % 4).toBe(0);
    expect(mesh.indexCount % 6).toBe(0);
    expect(mesh.indexCount / 6).toBe(mesh.vertexCount / 4);

    expect(mesh.positions.length).toBe(mesh.vertexCount * 3);
    expect(mesh.normals.length).toBe(mesh.vertexCount * 3);
    expect(mesh.colors.length).toBe(mesh.vertexCount * 3);

    // Every index must address a vertex that exists.
    for (let i = 0; i < mesh.indexCount; i++) {
      expect(mesh.indices[i]).toBeLessThan(mesh.vertexCount);
    }

    // Colours are baked lighting, so they must stay in gamut.
    for (let i = 0; i < mesh.colors.length; i++) {
      expect(mesh.colors[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.colors[i]).toBeLessThanOrEqual(1);
    }

    // Normals are axis-aligned unit vectors, one component set.
    for (let i = 0; i < mesh.vertexCount; i++) {
      const n = [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]];
      expect(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2])).toBe(1);
    }
  });

  it("does not emit interior faces between two solid blocks", () => {
    // A fully solid chunk surrounded by solid neighbours has nothing visible.
    const solid = new Uint8Array(world.data.length).fill(BLOCK.STONE);
    const middle = chunkIndex(2, 2, 2);
    const mesh = meshChunk(solid, middle);
    expect(mesh).toBeNull();
  });

  it("emits exactly six faces for a single floating block", () => {
    const data = new Uint8Array(world.data.length);
    data[idx(20, 40, 20)] = BLOCK.STONE;
    const mesh = meshChunk(data, chunkIndex(1, 2, 1));

    expect(mesh).not.toBeNull();
    expect(mesh?.vertexCount).toBe(24); // 6 faces x 4 vertices
    expect(mesh?.indexCount).toBe(36);
  });
});

/* ==========================================================================
   Raycasting
   ========================================================================== */

describe("raycast", () => {
  it("hits the surface when fired straight down", () => {
    const x = 40;
    const z = 40;
    const surface = world.surfaceAt(x, z);

    const hit = world.raycast(x + 0.5, H - 1, z + 0.5, 0, -1, 0, 200);

    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(x);
    expect(hit?.z).toBe(z);
    expect(hit?.y).toBe(surface);
    // Fired downward, so the face hit is the top of the block.
    expect(hit?.ny).toBe(1);
  });

  it("returns null when fired away from the world", () => {
    expect(world.raycast(40.5, H - 1, 40.5, 0, 1, 0, 200)).toBeNull();
  });

  it("returns null when it runs out of distance before reaching anything", () => {
    expect(world.raycast(40.5, H - 1, 40.5, 0, -1, 0, 2)).toBeNull();
  });

  it("reports a face normal pointing back along the ray", () => {
    const hit = world.raycast(-10, 30, 40.5, 1, 0, 0, 200);
    if (hit) {
      expect(hit.nx).toBe(-1);
      expect(hit.ny).toBe(0);
      expect(hit.nz).toBe(0);
    }
  });

  it("finds the same block a diagonal ray passes through", () => {
    const hit = world.raycast(40.5, H - 1, 40.5, 0.3, -1, 0.2, 200);
    expect(hit).not.toBeNull();
    if (hit) expect(IS_SOLID[world.get(hit.x, hit.y, hit.z)]).toBe(1);
  });
});

/* ==========================================================================
   Edits
   ========================================================================== */

describe("edits", () => {
  it("marks the containing chunk dirty and reports the new block", () => {
    const fresh = new VoxelWorld();
    fresh.data[idx(20, 40, 20)] = BLOCK.STONE;
    fresh.dirty.clear();

    expect(fresh.set(20, 40, 20, BLOCK.AIR)).toBe(true);
    expect(fresh.get(20, 40, 20)).toBe(BLOCK.AIR);
    expect(fresh.dirty.has(chunkIndex(1, 2, 1))).toBe(true);
  });

  it("dirties the neighbouring chunk when a block sits on a boundary", () => {
    const fresh = new VoxelWorld();
    fresh.dirty.clear();
    // x = 15 is the last voxel of chunk 0 along x.
    fresh.set(15, 40, 20, BLOCK.STONE);
    expect(fresh.dirty.has(chunkIndex(0, 2, 1))).toBe(true);
    expect(fresh.dirty.has(chunkIndex(1, 2, 1))).toBe(true);
  });

  it("ignores writes outside the claim", () => {
    const fresh = new VoxelWorld();
    expect(fresh.set(-1, 10, 10, BLOCK.STONE)).toBe(false);
    expect(fresh.set(W, 10, 10, BLOCK.STONE)).toBe(false);
    expect(fresh.set(10, H, 10, BLOCK.STONE)).toBe(false);
  });

  it("round-trips an edit log", () => {
    const fresh = new VoxelWorld();
    fresh.set(10, 40, 10, BLOCK.STONE);
    fresh.set(11, 40, 10, BLOCK.COAL_ORE);
    const log = fresh.serializeEdits();
    expect(log).toHaveLength(2);

    const restored = new VoxelWorld();
    restored.applyEdits(log);
    expect(restored.get(10, 40, 10)).toBe(BLOCK.STONE);
    expect(restored.get(11, 40, 10)).toBe(BLOCK.COAL_ORE);
  });

  it("restores exactly what a building covered when it is removed", () => {
    const fresh = new VoxelWorld();
    fresh.data[idx(30, 40, 30)] = BLOCK.STONE;
    fresh.data[idx(31, 40, 30)] = BLOCK.COAL_ORE;

    fresh.stamp("b1", [
      { x: 30, y: 40, z: 30, block: BLOCK.STEEL },
      { x: 31, y: 40, z: 30, block: BLOCK.STEEL },
    ]);
    expect(fresh.get(30, 40, 30)).toBe(BLOCK.STEEL);

    expect(fresh.unstamp("b1")).toBe(true);
    expect(fresh.get(30, 40, 30)).toBe(BLOCK.STONE);
    expect(fresh.get(31, 40, 30)).toBe(BLOCK.COAL_ORE);
  });

  it("refuses to place a building on ground that is too uneven", () => {
    const fresh = new VoxelWorld();
    // A single tall spike inside an otherwise flat 5x5 footprint.
    for (let z = 20; z < 25; z++) {
      for (let x = 20; x < 25; x++) fresh.data[idx(x, 10, z)] = BLOCK.STONE;
    }
    for (let y = 10; y < 20; y++) fresh.data[idx(22, y, 22)] = BLOCK.STONE;

    const check = fresh.canPlaceFootprint(20, 20, 5, 5);
    expect(check.ok).toBe(false);
  });

  it("accepts flat ground and levels to the highest point", () => {
    const fresh = new VoxelWorld();
    for (let z = 20; z < 25; z++) {
      for (let x = 20; x < 25; x++) fresh.data[idx(x, 10, z)] = BLOCK.STONE;
    }

    const check = fresh.canPlaceFootprint(20, 20, 5, 5);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.y).toBe(11);
  });
});
