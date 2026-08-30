import * as THREE from "three";
import {
  BASE,
  miningEnergyCost,
  miningTimeMs,
  miningYield,
  type PlayerStats,
} from "@/sim/economy";
import { depthLabel } from "@/sim/strata";
import { TimeSlice } from "@/lib/schedule";
import type { BuildingKind, RawResource } from "@/sim/types";
import { BLOCK, IS_ORE, blockDef } from "./blocks";
import { buildingVoxels, footprintCells, originFromCenter } from "./buildings";
import { OrbitCamera } from "./controls";
import { H, W } from "./coords";
import { meshChunk } from "./mesher";
import { Renderer } from "./renderer";
import { VoxelWorld, type RaycastHit } from "./world";
import { BUILDING_DEFS } from "@/sim/buildings";

/**
 * The game loop.
 *
 * Owns the world, the renderer and the camera, and drives them from a single
 * `requestAnimationFrame`. React never renders a frame; it hands the engine
 * parameters and receives coarse events back. That separation is what keeps
 * the game at 60fps while a marketplace panel is re-rendering next to it.
 */

export type EngineMode = "mine" | "build";

export interface HoverInfo {
  x: number;
  y: number;
  z: number;
  blockId: number;
  blockName: string;
  hardness: number;
  drop: RawResource | null;
  depth: string;
  /** Milliseconds to break at current stats, or Infinity. */
  breakMs: number;
  energyCost: number;
  progress: number;
}

export interface MineEvent {
  x: number;
  y: number;
  z: number;
  blockId: number;
  resource: RawResource | null;
  /** Fractional — the caller accumulates the remainder. */
  amount: number;
  energySpent: number;
  xp: number;
}

export interface PlacementRequest {
  kind: BuildingKind;
  originX: number;
  originZ: number;
  y: number;
  rotation: 0 | 1 | 2 | 3;
}

export interface EngineStats {
  fps: number;
  chunks: number;
  triangles: number;
  pixelRatio: number;
  pendingChunks: number;
  /** Ore blocks within scanner range of the camera focus. */
  oreNearby: number;
}

export interface EngineCallbacks {
  onLoadProgress?: (progress: number, label: string) => void;
  onReady?: () => void;
  onHover?: (info: HoverInfo | null) => void;
  onMined?: (event: MineEvent) => void;
  onPlace?: (request: PlacementRequest) => void;
  onBlocked?: (reason: string) => void;
  onStats?: (stats: EngineStats) => void;
}

const DEFAULT_STATS: PlayerStats = {
  energyMax: BASE.energyMax,
  energyRegen: BASE.energyRegen,
  miningSpeed: 0,
  yieldBonus: 0,
  energyCost: 0,
  extractorRate: 0,
  luck: 0,
  refineSpeed: 0,
};

/** Chunk meshing budget per frame. Above ~7ms the frame starts to show it. */
const MESH_BUDGET_MS = 6.5;

export class Engine {
  readonly world = new VoxelWorld();
  readonly camera = new OrbitCamera();

  #renderer: Renderer | null = null;
  #callbacks: EngineCallbacks = {};
  #running = false;
  #frame = 0;
  #lastTime = 0;

  #stats: PlayerStats = DEFAULT_STATS;
  #energy: number = BASE.energyMax;
  #hasScanner = false;

  #mode: EngineMode = "mine";
  #buildKind: BuildingKind | null = null;
  #buildRotation: 0 | 1 | 2 | 3 = 0;

  #hover: RaycastHit | null = null;
  #mining = false;
  #miningProgress = 0;
  #miningKey = "";

  #stampedBuildings = new Set<string>();

  #fpsSamples: number[] = [];
  #statsTimer = 0;
  #oreNearby = 0;

  /* ======================================================================
     Lifecycle
     ====================================================================== */

  async init(
    canvas: HTMLCanvasElement,
    seed: number,
    callbacks: EngineCallbacks = {}
  ): Promise<void> {
    this.#callbacks = callbacks;

    callbacks.onLoadProgress?.(0.02, "Reading claim deed");
    await this.world.generate(seed, (progress, label) => {
      // Terrain is roughly the first 70% of perceived load time.
      callbacks.onLoadProgress?.(0.02 + progress * 0.68, label);
    });

    this.#renderer = new Renderer(canvas);
    this.camera.attach(canvas);

    // Frame the claim from a low angle so the first thing seen is the
    // strata cross-section at the boundary, not a top-down grid.
    const surface = this.world.surfaceAt(Math.floor(W / 2), Math.floor(W / 2));
    this.camera.focusOn(W / 2, surface + 4, W / 2, 88);
    this.camera.setPose(Math.PI * 0.22, Math.PI * 0.3, 118);

    await this.#meshAll((progress) => {
      callbacks.onLoadProgress?.(0.7 + progress * 0.3, "Building geometry");
    });

    callbacks.onLoadProgress?.(1, "Ready");
    callbacks.onReady?.();

    this.start();
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = performance.now();
    this.#frame = requestAnimationFrame(this.#tick);
  }

  stop(): void {
    this.#running = false;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  dispose(): void {
    this.stop();
    this.camera.detach();
    this.#renderer?.dispose();
    this.#renderer = null;
  }

  resize(width: number, height: number): void {
    this.#renderer?.resize(width, height);
  }

  /* ======================================================================
     Parameters from the game store
     ====================================================================== */

  setStats(stats: PlayerStats, hasScanner: boolean): void {
    this.#stats = stats;
    this.#hasScanner = hasScanner;
  }

  setEnergy(energy: number): void {
    this.#energy = energy;
  }

  get energy(): number {
    return this.#energy;
  }

  setMode(mode: EngineMode, buildKind: BuildingKind | null = null): void {
    this.#mode = mode;
    this.#buildKind = buildKind;
    this.#mining = false;
    this.#miningProgress = 0;
    if (mode !== "build") this.#renderer?.clearGhost();
  }

  get mode(): EngineMode {
    return this.#mode;
  }

  rotateBuild(): void {
    this.#buildRotation = (((this.#buildRotation + 1) % 4) as 0 | 1 | 2 | 3);
  }

  /** Called when a panel opens, so the camera stops eating keystrokes. */
  setInputBlocked(blocked: boolean): void {
    this.camera.setInputBlocked(blocked);
    if (blocked) this.#mining = false;
  }

  /* ======================================================================
     Buildings
     ====================================================================== */

  /**
   * Reconciles world voxels with the authoritative building list.
   *
   * The chain (real or simulated) owns which buildings exist; the world is
   * just a rendering of that. Stamping is idempotent so this can be called on
   * every snapshot refresh without rebuilding anything that hasn't changed.
   */
  syncBuildings(
    buildings: ReadonlyArray<{
      id: string;
      kind: BuildingKind;
      level: number;
      x: number;
      y: number;
      z: number;
      rotation: 0 | 1 | 2 | 3;
    }>
  ): void {
    const live = new Set(buildings.map((b) => `${b.id}:${b.level}`));

    for (const key of this.#stampedBuildings) {
      if (!live.has(key)) {
        this.world.unstamp(key);
        this.#stampedBuildings.delete(key);
      }
    }

    for (const building of buildings) {
      // The level is part of the key so an upgrade re-stamps a bigger model.
      const key = `${building.id}:${building.level}`;
      if (this.#stampedBuildings.has(key)) continue;

      const voxels = buildingVoxels(
        building.kind,
        building.level,
        building.x,
        building.y,
        building.z,
        building.rotation,
        (x, z) => this.world.surfaceAt(x, z)
      );
      this.world.stamp(key, voxels);
      this.#stampedBuildings.add(key);
    }
  }

  focusBuilding(x: number, y: number, z: number): void {
    this.camera.focusOn(x, y + 3, z, 42);
  }

  /* ======================================================================
     Input from React
     ====================================================================== */

  onPrimaryDown(): void {
    if (this.#mode === "build") {
      this.#tryPlace();
      return;
    }
    this.#mining = true;
  }

  onPrimaryUp(): void {
    this.#mining = false;
    this.#miningProgress = 0;
  }

  #tryPlace(): void {
    const kind = this.#buildKind;
    const hover = this.#hover;
    if (!kind || !hover) return;

    const [originX, originZ] = originFromCenter(kind, hover.x, hover.z);
    const [width, depth] = BUILDING_DEFS[kind].footprint;
    const check = this.world.canPlaceFootprint(originX, originZ, width, depth);

    if (!check.ok) {
      this.#callbacks.onBlocked?.(check.reason);
      return;
    }

    this.#callbacks.onPlace?.({
      kind,
      originX,
      originZ,
      y: check.y,
      rotation: this.#buildRotation,
    });
  }

  /* ======================================================================
     Frame
     ====================================================================== */

  #tick = (now: number): void => {
    if (!this.#running || !this.#renderer) return;

    // Clamp dt so a backgrounded tab doesn't resume with a 30-second step
    // that teleports the camera and drains the whole energy pool at once.
    const dt = Math.min(0.1, (now - this.#lastTime) / 1000);
    this.#lastTime = now;

    // Energy regenerates in the engine rather than the store: it is read every
    // frame by the mining check, and routing that through React state would
    // mean a re-render per frame for a number that changes continuously.
    this.#energy = Math.min(
      this.#stats.energyMax,
      this.#energy + this.#stats.energyRegen * dt
    );

    this.camera.update(dt);
    this.camera.applyTo(this.#renderer.camera);

    this.#processMeshQueue();
    this.#updateHover(dt);
    this.#renderer.render(dt);

    this.#trackStats(dt);
    this.#frame = requestAnimationFrame(this.#tick);
  };

  /* ======================================================================
     Meshing
     ====================================================================== */

  async #meshAll(onProgress: (progress: number) => void): Promise<void> {
    const pending = Array.from(this.world.dirty);
    this.world.dirty.clear();

    const slice = new TimeSlice(14);

    for (let i = 0; i < pending.length; i++) {
      this.#renderer?.updateChunk(pending[i], meshChunk(this.world.data, pending[i]));

      if (await slice.maybeYield()) {
        onProgress(Math.min(1, (i + 1) / pending.length));
      }
    }

    onProgress(1);
  }

  /**
   * Rebuilds dirty chunks under a time budget.
   *
   * A single mined block can dirty up to eight chunks, and an upgraded Market
   * Hub can dirty a dozen. Doing them all in one frame is a visible stutter,
   * so the queue drains over as many frames as it needs.
   */
  #processMeshQueue(): void {
    if (this.world.dirty.size === 0) return;

    const deadline = performance.now() + MESH_BUDGET_MS;

    for (const index of this.world.dirty) {
      this.world.dirty.delete(index);
      this.#renderer?.updateChunk(index, meshChunk(this.world.data, index));
      if (performance.now() > deadline) break;
    }
  }

  /* ======================================================================
     Hover and mining
     ====================================================================== */

  #updateHover(dt: number): void {
    const renderer = this.#renderer;
    if (!renderer) return;

    const ray = this.camera.rayFromPointer(renderer.camera);

    if (!ray || this.camera.isDragging) {
      this.#hover = null;
      this.#mining = false;
      renderer.setHighlight(null);
      if (this.#mode === "build") renderer.clearGhost();
      this.#callbacks.onHover?.(null);
      return;
    }

    const hit = this.world.raycast(
      ray.origin.x,
      ray.origin.y,
      ray.origin.z,
      ray.direction.x,
      ray.direction.y,
      ray.direction.z,
      220
    );

    this.#hover = hit;

    if (!hit) {
      renderer.setHighlight(null);
      if (this.#mode === "build") renderer.clearGhost();
      this.#callbacks.onHover?.(null);
      return;
    }

    if (this.#mode === "build") {
      this.#updateGhost(hit);
      renderer.setHighlight(null);
      this.#callbacks.onHover?.(null);
      return;
    }

    this.#updateMining(hit, dt);
  }

  #updateGhost(hit: RaycastHit): void {
    const kind = this.#buildKind;
    if (!kind || !this.#renderer) return;

    const [originX, originZ] = originFromCenter(kind, hit.x, hit.z);
    const [width, depth] = BUILDING_DEFS[kind].footprint;
    const check = this.world.canPlaceFootprint(originX, originZ, width, depth);

    const cells = footprintCells(kind, originX, originZ).map(
      ([x, z]) => [x, this.world.surfaceAt(x, z) + 1, z] as [number, number, number]
    );

    this.#renderer.setGhost(cells, check.ok);
  }

  #updateMining(hit: RaycastHit, dt: number): void {
    const definition = blockDef(hit.blockId);
    const breakMs = miningTimeMs(definition.hardness, this.#stats);
    const energyCost = miningEnergyCost(definition.hardness, this.#stats);
    const breakable = Number.isFinite(breakMs) && this.#energy >= energyCost;

    const key = `${hit.x},${hit.y},${hit.z}`;
    if (key !== this.#miningKey) {
      this.#miningKey = key;
      this.#miningProgress = 0;
    }

    if (this.#mining && breakable) {
      this.#miningProgress += (dt * 1000) / breakMs;

      if (this.#miningProgress >= 1) {
        this.#breakBlock(hit, definition.hardness, energyCost);
        this.#miningProgress = 0;
      }
    } else if (!this.#mining) {
      this.#miningProgress = 0;
    }

    this.#renderer?.setHighlight({
      x: hit.x,
      y: hit.y,
      z: hit.z,
      progress: this.#miningProgress,
      breakable,
    });

    this.#callbacks.onHover?.({
      x: hit.x,
      y: hit.y,
      z: hit.z,
      blockId: hit.blockId,
      blockName: definition.name,
      hardness: definition.hardness,
      drop: definition.drop,
      depth: depthLabel(hit.y),
      breakMs,
      energyCost,
      progress: this.#miningProgress,
    });
  }

  #breakBlock(hit: RaycastHit, hardness: number, energyCost: number): void {
    const definition = blockDef(hit.blockId);

    this.world.set(hit.x, hit.y, hit.z, BLOCK.AIR);
    this.#renderer?.spawnBreakParticles(hit.x, hit.y, hit.z, hit.blockId);

    this.#energy = Math.max(0, this.#energy - energyCost);

    this.#callbacks.onMined?.({
      x: hit.x,
      y: hit.y,
      z: hit.z,
      blockId: hit.blockId,
      resource: definition.drop,
      amount: definition.drop ? miningYield(this.#stats) : 0,
      energySpent: energyCost,
      xp: Number.isFinite(hardness) ? Math.max(1, Math.round(hardness * 2)) : 0,
    });
  }

  /* ======================================================================
     Stats
     ====================================================================== */

  #trackStats(dt: number): void {
    this.#fpsSamples.push(dt);
    if (this.#fpsSamples.length > 30) this.#fpsSamples.shift();

    this.#statsTimer += dt;
    if (this.#statsTimer < 0.5) return;
    this.#statsTimer = 0;

    if (this.#hasScanner) this.#oreNearby = this.#countOreNearby();

    const average =
      this.#fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.#fpsSamples.length);

    this.#callbacks.onStats?.({
      fps: Math.round(1 / Math.max(1e-6, average)),
      chunks: this.#renderer?.drawnChunks ?? 0,
      triangles: this.#renderer?.triangleCount ?? 0,
      pixelRatio: Number((this.#renderer?.pixelRatio ?? 1).toFixed(2)),
      pendingChunks: this.world.dirty.size,
      oreNearby: this.#hasScanner ? this.#oreNearby : -1,
    });
  }

  /**
   * Counts ore blocks around the camera focus.
   *
   * This is what an equipped Scanner actually shows the player. Sampling a
   * 21-block cube every half second is ~9k array reads — cheap enough to run
   * unconditionally, but gated on having a Scanner so the readout means
   * something rather than being free information.
   */
  #countOreNearby(): number {
    const cx = Math.round(this.camera.target.x);
    const cy = Math.round(this.camera.target.y);
    const cz = Math.round(this.camera.target.z);
    const radius = 10;

    let count = 0;
    for (let z = cz - radius; z <= cz + radius; z++) {
      if (z < 0 || z >= W) continue;
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || x >= W) continue;
        for (let y = cy - radius; y <= cy + radius; y++) {
          if (y < 0 || y >= H) continue;
          if (IS_ORE[this.world.get(x, y, z)]) count++;
        }
      }
    }
    return count;
  }

  /** Where the camera is looking — persisted so a reload returns you there. */
  getCameraTarget(): THREE.Vector3 {
    return this.camera.target.clone();
  }
}
