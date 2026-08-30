import * as THREE from "three";
import { blockDef } from "./blocks";
import { CHUNK, H, W, chunkOrigin } from "./coords";
import type { ChunkMesh } from "./mesher";

/**
 * Three.js scene management.
 *
 * Deliberately hand-rolled rather than react-three-fiber. A voxel world
 * rebuilds geometry constantly, and R3F's model — scene graph as a function of
 * React state — fights that: every remesh would either force a reconciliation
 * pass or bypass React entirely, at which point the abstraction is only
 * costing you. Direct Three.js keeps geometry lifetimes explicit, which is the
 * one thing that actually matters for not leaking GPU memory here.
 *
 * The renderer knows nothing about game rules. It is handed meshes, a
 * highlight, a ghost and a camera pose, and it draws them.
 */

const SKY_TOP = new THREE.Color("#070b14");
const SKY_HORIZON = new THREE.Color("#243449");
const SUN_TINT = new THREE.Color("#ffcf9b");

export interface HighlightState {
  x: number;
  y: number;
  z: number;
  /** 0-1 mining progress. Drives the crack overlay. */
  progress: number;
  breakable: boolean;
}

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  #chunks = new Map<number, THREE.Mesh>();
  #material: THREE.MeshLambertMaterial;
  #chunkGroup = new THREE.Group();

  #highlight: THREE.LineSegments;
  #highlightFill: THREE.Mesh;
  #ghostGroup = new THREE.Group();
  #ghostMaterialOk: THREE.MeshBasicMaterial;
  #ghostMaterialBad: THREE.MeshBasicMaterial;

  #particles: THREE.InstancedMesh;
  #particleState: Particle[] = [];
  #particleCursor = 0;

  #frameTimes: number[] = [];
  #targetPixelRatio: number;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      // The canvas sits on an opaque page; skipping alpha saves a blend.
      alpha: false,
      stencil: false,
    });

    this.#targetPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.#targetPixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 900);

    /* ---- atmosphere -------------------------------------------------- */

    this.scene.background = SKY_TOP.clone();
    // Fog hides the claim's far edge and gives the underground real depth.
    this.scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 90, 340);
    this.scene.add(this.#buildSky());

    const hemisphere = new THREE.HemisphereLight(0xa8c4e0, 0x2b2118, 1.05);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(SUN_TINT, 0.85);
    sun.position.set(0.55, 1, 0.35).normalize();
    this.scene.add(sun);

    // A weak fill from the opposite side so unlit faces aren't pure black.
    const fill = new THREE.DirectionalLight(0x5a7ea8, 0.28);
    fill.position.set(-0.5, 0.35, -0.6).normalize();
    this.scene.add(fill);

    /* ---- world ------------------------------------------------------- */

    this.#material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // Every quad is wound outward, so back faces are never wanted.
      side: THREE.FrontSide,
    });
    this.scene.add(this.#chunkGroup);

    /* ---- selection --------------------------------------------------- */

    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.#highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.95 })
    );
    this.#highlight.visible = false;
    this.#highlight.renderOrder = 2;
    this.scene.add(this.#highlight);

    this.#highlightFill = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xff6b35,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.#highlightFill.visible = false;
    this.#highlightFill.renderOrder = 1;
    this.scene.add(this.#highlightFill);

    /* ---- placement ghost --------------------------------------------- */

    this.#ghostMaterialOk = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.#ghostMaterialBad = new THREE.MeshBasicMaterial({
      color: 0xfb6e4e,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.scene.add(this.#ghostGroup);

    /* ---- debris ------------------------------------------------------ */

    this.#particles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      new THREE.MeshLambertMaterial({ vertexColors: false }),
      MAX_PARTICLES
    );
    this.#particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.#particles.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_PARTICLES * 3),
      3
    );
    this.#particles.frustumCulled = false;
    this.#particles.count = MAX_PARTICLES;
    this.scene.add(this.#particles);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.#particleState.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 });
    }
    this.#hideAllParticles();
  }

  /* ======================================================================
     Sky
     ====================================================================== */

  #buildSky(): THREE.Mesh {
    // A gradient dome costs one draw call and does more for the mood than any
    // amount of post-processing would at this budget.
    const geometry = new THREE.SphereGeometry(600, 24, 16);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: SKY_TOP },
        horizon: { value: SKY_HORIZON },
        sunTint: { value: SUN_TINT },
        sunDir: { value: new THREE.Vector3(0.55, 0.32, 0.35).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 sunTint;
        uniform vec3 sunDir;
        varying vec3 vDirection;

        void main() {
          vec3 dir = normalize(vDirection);
          float height = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 color = mix(horizon, top, smoothstep(0.42, 0.95, height));

          // Warm bloom around the sun, and a low haze band at the horizon.
          float sun = pow(max(dot(dir, normalize(sunDir)), 0.0), 14.0);
          float haze = pow(1.0 - abs(dir.y), 6.0) * 0.35;
          color += sunTint * (sun * 0.55 + haze * 0.4);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    return mesh;
  }

  /* ======================================================================
     Chunks
     ====================================================================== */

  /**
   * Replaces one chunk's geometry.
   *
   * Passing `null` removes it — a chunk can become empty when a player digs
   * out everything in it. Old geometry is disposed explicitly; leaving it to
   * the GC leaks VRAM, which browsers will not reclaim on their own.
   */
  updateChunk(index: number, mesh: ChunkMesh | null): void {
    const existing = this.#chunks.get(index);

    if (!mesh) {
      if (existing) {
        this.#chunkGroup.remove(existing);
        existing.geometry.dispose();
        this.#chunks.delete(index);
      }
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

    // Chunk bounds are known exactly, so skip Three's bounding-sphere scan.
    const [ox, oy, oz] = chunkOrigin(index);
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(ox + CHUNK / 2, oy + CHUNK / 2, oz + CHUNK / 2),
      CHUNK * 0.87
    );

    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geometry;
      return;
    }

    const object = new THREE.Mesh(geometry, this.#material);
    object.frustumCulled = true;
    this.#chunkGroup.add(object);
    this.#chunks.set(index, object);
  }

  clearChunks(): void {
    for (const mesh of this.#chunks.values()) {
      this.#chunkGroup.remove(mesh);
      mesh.geometry.dispose();
    }
    this.#chunks.clear();
  }

  get drawnChunks(): number {
    return this.#chunks.size;
  }

  get triangleCount(): number {
    return this.renderer.info.render.triangles;
  }

  /* ======================================================================
     Highlight
     ====================================================================== */

  setHighlight(state: HighlightState | null): void {
    if (!state) {
      this.#highlight.visible = false;
      this.#highlightFill.visible = false;
      return;
    }

    this.#highlight.visible = true;
    this.#highlight.position.set(state.x + 0.5, state.y + 0.5, state.z + 0.5);
    (this.#highlight.material as THREE.LineBasicMaterial).color.setHex(
      state.breakable ? 0xff9a2e : 0xfb6e4e
    );

    // The fill grows and brightens as the block gives way, so mining has
    // feedback in the world rather than only on a HUD bar.
    if (state.progress > 0.01) {
      this.#highlightFill.visible = true;
      this.#highlightFill.position.copy(this.#highlight.position);
      const scale = 0.55 + state.progress * 0.5;
      this.#highlightFill.scale.setScalar(scale);
      (this.#highlightFill.material as THREE.MeshBasicMaterial).opacity =
        0.12 + state.progress * 0.45;
    } else {
      this.#highlightFill.visible = false;
    }
  }

  /* ======================================================================
     Placement ghost
     ====================================================================== */

  setGhost(cells: ReadonlyArray<[number, number, number]>, valid: boolean): void {
    while (this.#ghostGroup.children.length > cells.length) {
      const child = this.#ghostGroup.children.pop() as THREE.Mesh;
      child.geometry.dispose();
    }

    const material = valid ? this.#ghostMaterialOk : this.#ghostMaterialBad;

    cells.forEach(([x, y, z], i) => {
      let mesh = this.#ghostGroup.children[i] as THREE.Mesh | undefined;
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.12, 0.94), material);
        mesh.renderOrder = 3;
        this.#ghostGroup.add(mesh);
      }
      mesh.material = material;
      mesh.position.set(x + 0.5, y + 0.06, z + 0.5);
    });
  }

  clearGhost(): void {
    for (const child of this.#ghostGroup.children) {
      (child as THREE.Mesh).geometry.dispose();
    }
    this.#ghostGroup.clear();
  }

  /* ======================================================================
     Debris
     ====================================================================== */

  /** A burst of chips in the block's own colour when it breaks. */
  spawnBreakParticles(x: number, y: number, z: number, blockId: number): void {
    const def = blockDef(blockId);
    const color = new THREE.Color(def.color[0], def.color[1], def.color[2]);

    for (let i = 0; i < 14; i++) {
      const slot = this.#particleCursor;
      this.#particleCursor = (this.#particleCursor + 1) % MAX_PARTICLES;

      const particle = this.#particleState[slot];
      particle.life = 0.75 + Math.random() * 0.5;
      particle.x = x + 0.5 + (Math.random() - 0.5) * 0.7;
      particle.y = y + 0.5 + (Math.random() - 0.5) * 0.7;
      particle.z = z + 0.5 + (Math.random() - 0.5) * 0.7;
      particle.vx = (Math.random() - 0.5) * 4.2;
      particle.vy = 2.4 + Math.random() * 3.4;
      particle.vz = (Math.random() - 0.5) * 4.2;
      particle.spin = (Math.random() - 0.5) * 9;

      this.#particles.instanceColor!.setXYZ(slot, color.r, color.g, color.b);
    }

    this.#particles.instanceColor!.needsUpdate = true;
  }

  #hideAllParticles(): void {
    const matrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) this.#particles.setMatrixAt(i, matrix);
    this.#particles.instanceMatrix.needsUpdate = true;
  }

  #stepParticles(dt: number): void {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    let any = false;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.#particleState[i];
      if (p.life <= 0) continue;

      any = true;
      p.life -= dt;

      if (p.life <= 0) {
        matrix.makeScale(0, 0, 0);
        this.#particles.setMatrixAt(i, matrix);
        continue;
      }

      p.vy -= 15 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Bounce once off nothing in particular — the debris only has to read
      // as debris, and a real collision query per chip is not worth it.
      if (p.vy < 0 && p.life < 0.35) {
        p.vx *= 0.94;
        p.vz *= 0.94;
      }

      const fade = Math.min(1, p.life * 2.2);
      position.set(p.x, p.y, p.z);
      euler.set(p.x * p.spin, p.y * p.spin, 0);
      quaternion.setFromEuler(euler);
      scale.setScalar(fade);
      matrix.compose(position, quaternion, scale);
      this.#particles.setMatrixAt(i, matrix);
    }

    if (any) this.#particles.instanceMatrix.needsUpdate = true;
  }

  /* ======================================================================
     Frame
     ====================================================================== */

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render(dt: number): void {
    this.#stepParticles(dt);
    this.renderer.render(this.scene, this.camera);
    this.#adaptResolution(dt);
  }

  /**
   * Drops render resolution on sustained slow frames.
   *
   * Voxel scenes are fill-rate bound more than anything, so resolution is the
   * lever that actually helps. Uses a rolling window rather than a single
   * frame so one hitch — a chunk remesh, a GC pause — doesn't permanently
   * degrade quality on a machine that was coping fine.
   */
  #adaptResolution(dt: number): void {
    this.#frameTimes.push(dt);
    if (this.#frameTimes.length < 60) return;

    const average = this.#frameTimes.reduce((a, b) => a + b, 0) / this.#frameTimes.length;
    this.#frameTimes.length = 0;

    const max = Math.min(window.devicePixelRatio || 1, 2);

    if (average > 1 / 40 && this.#targetPixelRatio > 0.65) {
      this.#targetPixelRatio = Math.max(0.65, this.#targetPixelRatio - 0.15);
      this.renderer.setPixelRatio(this.#targetPixelRatio);
    } else if (average < 1 / 58 && this.#targetPixelRatio < max) {
      this.#targetPixelRatio = Math.min(max, this.#targetPixelRatio + 0.1);
      this.renderer.setPixelRatio(this.#targetPixelRatio);
    }
  }

  get pixelRatio(): number {
    return this.#targetPixelRatio;
  }

  dispose(): void {
    this.clearChunks();
    this.clearGhost();
    this.#material.dispose();
    this.#highlight.geometry.dispose();
    (this.#highlight.material as THREE.Material).dispose();
    this.#highlightFill.geometry.dispose();
    (this.#highlightFill.material as THREE.Material).dispose();
    this.#particles.geometry.dispose();
    (this.#particles.material as THREE.Material).dispose();
    this.#ghostMaterialOk.dispose();
    this.#ghostMaterialBad.dispose();
    this.renderer.dispose();
  }
}

interface Particle {
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
}

const MAX_PARTICLES = 320;

/** World centre at ground level — the camera's initial focus. */
export const WORLD_CENTER = new THREE.Vector3(W / 2, H * 0.62, W / 2);
