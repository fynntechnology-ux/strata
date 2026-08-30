import { BUILDING_DEFS } from "@/sim/buildings";
import type { BuildingKind } from "@/sim/types";
import { BLOCK } from "./blocks";

/**
 * Procedural voxel models for city buildings.
 *
 * Buildings are written into the same voxel array as the terrain, which means
 * they mesh with it, catch the same ambient occlusion, and can be mined
 * through. The alternative — separate GLTF props sitting on top of the
 * ground — would have needed its own lighting path and would never quite have
 * matched. Models are generated rather than authored so a level 5 Smelter can
 * be visibly bigger than a level 1 without shipping five meshes for each.
 */

export interface Voxel {
  x: number;
  y: number;
  z: number;
  block: number;
}

/* ==========================================================================
   Primitives — all coordinates are local to the footprint's min corner
   ========================================================================== */

class Model {
  readonly voxels: Voxel[] = [];

  set(x: number, y: number, z: number, block: number): this {
    this.voxels.push({ x, y, z, block });
    return this;
  }

  box(x0: number, y0: number, z0: number, w: number, h: number, d: number, block: number): this {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
          this.set(x0 + x, y0 + y, z0 + z, block);
        }
      }
    }
    return this;
  }

  /** Walls only — hollow, so interiors read as rooms rather than solid lumps. */
  shell(x0: number, y0: number, z0: number, w: number, h: number, d: number, block: number): this {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
          const edge = x === 0 || x === w - 1 || z === 0 || z === d - 1;
          if (edge) this.set(x0 + x, y0 + y, z0 + z, block);
        }
      }
    }
    return this;
  }

  column(x: number, y0: number, z: number, height: number, block: number): this {
    for (let y = 0; y < height; y++) this.set(x, y0 + y, z, block);
    return this;
  }

  /** A horizontal band around a shell — window strips, hazard stripes. */
  ring(x0: number, y: number, z0: number, w: number, d: number, block: number): this {
    for (let x = 0; x < w; x++) {
      this.set(x0 + x, y, z0, block);
      this.set(x0 + x, y, z0 + d - 1, block);
    }
    for (let z = 1; z < d - 1; z++) {
      this.set(x0, y, z0 + z, block);
      this.set(x0 + w - 1, y, z0 + z, block);
    }
    return this;
  }

  corners(x0: number, y: number, z0: number, w: number, d: number, block: number): this {
    this.set(x0, y, z0, block);
    this.set(x0 + w - 1, y, z0, block);
    this.set(x0, y, z0 + d - 1, block);
    this.set(x0 + w - 1, y, z0 + d - 1, block);
    return this;
  }
}

/* ==========================================================================
   Models
   ========================================================================== */

function extractor(level: number): Model {
  const m = new Model();
  const towerHeight = 4 + level;

  // Deck
  m.box(0, 0, 0, 5, 1, 5, BLOCK.STEEL_DARK);
  m.corners(0, 1, 0, 5, 5, BLOCK.PIPE);
  m.corners(0, 2, 0, 5, 5, BLOCK.PIPE);

  // Drill housing
  m.shell(1, 1, 1, 3, towerHeight, 3, BLOCK.STEEL);
  m.box(1, 1 + towerHeight, 1, 3, 1, 3, BLOCK.STEEL_DARK);

  // The bore itself, punched down through the deck
  m.column(2, -2, 2, 3, BLOCK.PIPE);

  // Hazard lighting — one lamp per level, so upgrades are legible at a glance
  for (let i = 0; i < Math.min(4, level); i++) {
    const y = 2 + i * Math.max(1, Math.floor(towerHeight / 4));
    m.set(0, y, 0, BLOCK.EMBER);
    m.set(4, y, 4, BLOCK.EMBER);
  }
  m.set(2, 1 + towerHeight, 2, BLOCK.LAMP);

  return m;
}

function smelter(level: number): Model {
  const m = new Model();
  const stackHeight = 5 + level;

  m.box(0, 0, 0, 5, 2, 5, BLOCK.CONCRETE);
  m.shell(0, 2, 0, 5, 3, 5, BLOCK.RUST);
  m.box(0, 5, 0, 5, 1, 5, BLOCK.STEEL_DARK);

  // Chimney
  m.shell(1, 6, 1, 2, stackHeight, 2, BLOCK.STEEL_DARK);
  m.box(1, 6 + stackHeight, 1, 2, 1, 2, BLOCK.EMBER);

  // Furnace mouth — the glow that tells you it's running
  m.set(2, 3, 0, BLOCK.EMBER);
  m.set(2, 2, 0, BLOCK.EMBER);
  m.set(1, 3, 0, BLOCK.LAMP);
  m.set(3, 3, 0, BLOCK.LAMP);

  if (level >= 3) {
    m.column(4, 2, 4, 4, BLOCK.PIPE);
    m.set(4, 6, 4, BLOCK.EMBER);
  }

  return m;
}

function generator(level: number): Model {
  const m = new Model();

  m.box(0, 0, 0, 5, 1, 5, BLOCK.STEEL_DARK);
  m.box(0, 1, 0, 5, 3, 5, BLOCK.COPPER_PLATE);
  m.ring(0, 4, 0, 5, 5, BLOCK.STEEL);

  // Turbine stacks
  const stack = 3 + level;
  m.column(1, 5, 1, stack, BLOCK.PIPE);
  m.column(3, 5, 3, stack, BLOCK.PIPE);
  m.set(1, 5 + stack, 1, BLOCK.EMBER);
  m.set(3, 5 + stack, 3, BLOCK.EMBER);

  // Output indicator strip
  for (let i = 0; i < Math.min(5, level + 1); i++) {
    m.set(i, 2, 0, BLOCK.LAMP);
  }

  return m;
}

function silo(level: number): Model {
  const m = new Model();
  const height = 4 + level;

  m.box(0, 0, 0, 3, 1, 3, BLOCK.CONCRETE);
  m.shell(0, 1, 0, 3, height, 3, BLOCK.STEEL);
  // Centre stays hollow so the silo reads as a vessel, not a pillar
  m.ring(0, Math.floor(height / 2) + 1, 0, 3, 3, BLOCK.STEEL_DARK);
  m.box(0, height + 1, 0, 3, 1, 3, BLOCK.STEEL_DARK);
  m.set(1, height + 2, 1, BLOCK.LAMP);

  return m;
}

function habitat(level: number): Model {
  const m = new Model();
  const floors = 1 + Math.floor(level / 2);

  m.box(0, 0, 0, 5, 1, 5, BLOCK.CONCRETE);

  for (let floor = 0; floor < floors; floor++) {
    const y = 1 + floor * 3;
    m.shell(0, y, 0, 5, 1, 5, BLOCK.PANEL);
    m.shell(0, y + 1, 0, 5, 1, 5, BLOCK.GLASS); // window band
    m.shell(0, y + 2, 0, 5, 1, 5, BLOCK.PANEL);
  }

  const roof = 1 + floors * 3;
  m.box(0, roof, 0, 5, 1, 5, BLOCK.STEEL_DARK);
  m.corners(0, roof + 1, 0, 5, 5, BLOCK.LAMP);

  return m;
}

function market(level: number): Model {
  const m = new Model();

  // Plaza
  m.box(0, 0, 0, 7, 1, 7, BLOCK.CONCRETE);
  m.ring(0, 1, 0, 7, 7, BLOCK.STEEL_DARK);

  // Trading hall
  m.shell(1, 1, 1, 5, 4, 5, BLOCK.PANEL);
  m.shell(1, 3, 1, 5, 1, 5, BLOCK.GLASS);
  m.box(1, 5, 1, 5, 1, 5, BLOCK.STEEL_DARK);

  // Signal mast — the tallest thing in a starting city, on purpose
  const mast = 3 + level;
  m.column(3, 6, 3, mast, BLOCK.PIPE);
  m.set(3, 6 + mast, 3, BLOCK.MARKER);

  m.corners(0, 1, 0, 7, 7, BLOCK.LAMP);
  m.set(3, 1, 0, BLOCK.EMBER);
  m.set(3, 2, 0, BLOCK.EMBER);

  return m;
}

function lab(level: number): Model {
  const m = new Model();

  m.box(0, 0, 0, 5, 1, 5, BLOCK.CONCRETE);
  m.shell(0, 1, 0, 5, 4, 5, BLOCK.PANEL);
  m.shell(0, 2, 0, 5, 2, 5, BLOCK.GLASS);

  // Resonance core, suspended in the middle
  const coreHeight = 2 + Math.floor(level / 2);
  m.column(2, 1, 2, coreHeight, BLOCK.CRYSTAL_BLOCK);

  m.box(1, 5, 1, 3, 1, 3, BLOCK.STEEL);
  m.set(2, 6, 2, BLOCK.CRYSTAL_BLOCK);
  m.corners(0, 5, 0, 5, 5, BLOCK.LAMP);

  return m;
}

const MODELS: Record<BuildingKind, (level: number) => Model> = {
  extractor,
  smelter,
  generator,
  silo,
  habitat,
  market,
  lab,
};

/* ==========================================================================
   Placement
   ========================================================================== */

/**
 * Resolves a building to world-space voxels.
 *
 * Also lays a foundation: every column under the footprint is filled with
 * concrete down to solid ground. Without it a building placed near a slope
 * hangs in the air on one side, which looks like a bug even though the
 * placement check allowed it.
 */
export function buildingVoxels(
  kind: BuildingKind,
  level: number,
  originX: number,
  groundY: number,
  originZ: number,
  rotation: 0 | 1 | 2 | 3,
  surfaceAt: (x: number, z: number) => number
): Voxel[] {
  const def = BUILDING_DEFS[kind];
  const [width, depth] = def.footprint;
  const model = MODELS[kind](Math.max(1, Math.min(def.maxLevel, level)));

  const out: Voxel[] = [];

  // Foundation
  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) {
      const [wx, wz] = rotate(dx, dz, width, depth, rotation);
      const column = surfaceAt(originX + wx, originZ + wz);
      for (let y = column + 1; y < groundY; y++) {
        out.push({ x: originX + wx, y, z: originZ + wz, block: BLOCK.CONCRETE });
      }
    }
  }

  for (const voxel of model.voxels) {
    const [wx, wz] = rotate(voxel.x, voxel.z, width, depth, rotation);
    out.push({
      x: originX + wx,
      y: groundY + voxel.y,
      z: originZ + wz,
      block: voxel.block,
    });
  }

  return out;
}

/** Quarter-turns within a square footprint. */
function rotate(
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation: 0 | 1 | 2 | 3
): [number, number] {
  switch (rotation) {
    case 1:
      return [depth - 1 - z, x];
    case 2:
      return [width - 1 - x, depth - 1 - z];
    case 3:
      return [z, width - 1 - x];
    default:
      return [x, z];
  }
}

/** Footprint in world coordinates, for the placement ghost. */
export function footprintCells(
  kind: BuildingKind,
  originX: number,
  originZ: number
): Array<[number, number]> {
  const [width, depth] = BUILDING_DEFS[kind].footprint;
  const cells: Array<[number, number]> = [];
  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) {
      cells.push([originX + dx, originZ + dz]);
    }
  }
  return cells;
}

/** Centres a footprint on a clicked cell, so the cursor is the middle. */
export function originFromCenter(
  kind: BuildingKind,
  centerX: number,
  centerZ: number
): [number, number] {
  const [width, depth] = BUILDING_DEFS[kind].footprint;
  return [centerX - Math.floor(width / 2), centerZ - Math.floor(depth / 2)];
}
