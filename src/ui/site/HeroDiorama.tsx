"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Rng } from "@/lib/rng";
import { BLOCK, blockDef } from "@/game/blocks";

/**
 * The hero diorama: a small voxel island that turns slowly.
 *
 * Built from a single `InstancedMesh` rather than a meshed chunk. The island
 * is ~1,600 visible blocks, which is one draw call and no geometry generation
 * at all — far cheaper than pulling in the real mesher, and it lets the same
 * palette and lighting model as the game run on a marketing page without
 * shipping the game.
 *
 * Only blocks with an exposed face are emitted. The interior of a solid island
 * is invisible by definition, and skipping it cuts the instance count by more
 * than half.
 */

const SIZE = 19;
const DEPTH = 13;

interface Cell {
  x: number;
  y: number;
  z: number;
  block: number;
}

/** Layers the island the same way the real world layers a claim. */
function blockForDepth(depthBelowSurface: number, rng: Rng): number {
  if (depthBelowSurface === 0) return rng.bool(0.12) ? BLOCK.GRAVEL : BLOCK.GRASS;
  if (depthBelowSurface < 3) return BLOCK.DIRT;
  if (depthBelowSurface < 7) {
    if (rng.bool(0.07)) return BLOCK.COAL_ORE;
    if (rng.bool(0.05)) return BLOCK.IRON_ORE;
    if (rng.bool(0.03)) return BLOCK.COPPER_ORE;
    return BLOCK.STONE;
  }
  if (depthBelowSurface < 11) {
    if (rng.bool(0.05)) return BLOCK.SILVER_ORE;
    if (rng.bool(0.035)) return BLOCK.TITANIUM_ORE;
    return BLOCK.DEEPSLATE;
  }
  if (rng.bool(0.06)) return BLOCK.CRYSTAL_ORE;
  if (rng.bool(0.025)) return BLOCK.VOID_ORE;
  return BLOCK.BASALT;
}

function buildIsland(seed: number): Cell[] {
  const rng = new Rng(seed);
  const solid = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  const half = Math.floor(SIZE / 2);
  const heights = new Map<string, number>();

  for (let z = -half; z <= half; z++) {
    for (let x = -half; x <= half; x++) {
      // Round the island off, and taper the underside into a keel so it reads
      // as a floating chunk of ground rather than a cube.
      const radius = Math.sqrt(x * x + z * z);
      if (radius > half + 0.4) continue;

      const top = Math.round(rng.range(-0.6, 0.9) + (radius < 4 ? 0.6 : 0));
      heights.set(`${x},${z}`, top);

      const bottom = -DEPTH + Math.round(radius * 0.72);
      for (let y = bottom; y <= top; y++) {
        solid.set(key(x, y, z), blockForDepth(top - y, rng));
      }
    }
  }

  /* ---- a small settlement on top ------------------------------------- */

  const put = (x: number, y: number, z: number, block: number) => {
    solid.set(key(x, y, z), block);
  };

  /**
   * Levels a footprint and returns the deck height.
   *
   * The island's surface is uneven, so a building placed at one column's
   * height ends up floating over its neighbours. Taking the maximum and
   * filling concrete down to each column is the same thing the real game does
   * when it lays a foundation.
   */
  const level = (x0: number, z0: number, w: number, d: number): number => {
    let top = -Infinity;
    for (let z = z0; z < z0 + d; z++) {
      for (let x = x0; x < x0 + w; x++) {
        top = Math.max(top, heights.get(`${x},${z}`) ?? 0);
      }
    }
    for (let z = z0; z < z0 + d; z++) {
      for (let x = x0; x < x0 + w; x++) {
        const surface = heights.get(`${x},${z}`) ?? 0;
        for (let y = surface; y <= top; y++) put(x, y, z, BLOCK.CONCRETE);
      }
    }
    return top + 1;
  };

  // Extractor: a squat deck with a drill tower punching up out of it.
  {
    const base = level(-6, -4, 5, 5);
    for (let z = -4; z < 1; z++) {
      for (let x = -6; x < -1; x++) put(x, base, z, BLOCK.STEEL_DARK);
    }
    for (let y = 1; y <= 6; y++) {
      for (let z = -3; z < 0; z++) {
        for (let x = -5; x < -2; x++) {
          const edge = x === -5 || x === -3 || z === -3 || z === -1;
          if (edge) put(x, base + y, z, y >= 5 ? BLOCK.STEEL : BLOCK.PIPE);
        }
      }
    }
    put(-4, base + 7, -2, BLOCK.LAMP);
    put(-5, base + 3, -3, BLOCK.EMBER);
    put(-3, base + 3, -1, BLOCK.EMBER);
    put(-6, base + 1, -4, BLOCK.PIPE);
    put(-2, base + 1, 0, BLOCK.PIPE);
  }

  // Smelter: solid body, tall lit chimney. The visual anchor of the scene.
  {
    const base = level(2, 1, 5, 5);
    for (let y = 0; y < 4; y++) {
      for (let z = 1; z < 6; z++) {
        for (let x = 2; x < 7; x++) {
          const edge = x === 2 || x === 6 || z === 1 || z === 5;
          if (edge || y === 0 || y === 3) {
            put(x, base + y, z, y === 3 ? BLOCK.STEEL_DARK : BLOCK.RUST);
          }
        }
      }
    }
    for (let y = 4; y < 9; y++) {
      put(4, base + y, 3, BLOCK.STEEL_DARK);
      put(5, base + y, 3, BLOCK.STEEL_DARK);
    }
    put(4, base + 9, 3, BLOCK.EMBER);
    put(5, base + 9, 3, BLOCK.EMBER);
    put(4, base + 1, 1, BLOCK.EMBER);
    put(3, base + 2, 1, BLOCK.LAMP);
  }

  // Habitat: window band makes it read as somewhere people live.
  {
    const base = level(1, -6, 5, 5);
    for (let y = 0; y < 5; y++) {
      for (let z = -6; z < -1; z++) {
        for (let x = 1; x < 6; x++) {
          const edge = x === 1 || x === 5 || z === -6 || z === -2;
          if (y === 4) put(x, base + y, z, BLOCK.STEEL_DARK);
          else if (edge) put(x, base + y, z, y === 2 ? BLOCK.GLASS : BLOCK.PANEL);
        }
      }
    }
    put(1, base + 5, -6, BLOCK.LAMP);
    put(5, base + 5, -2, BLOCK.LAMP);
  }

  // A claim marker on the far edge, echoing the corner pylons in game.
  {
    const surface = heights.get("-2,5") ?? 0;
    for (let y = 1; y <= 5; y++) {
      put(-2, surface + y, 5, y === 5 ? BLOCK.MARKER : BLOCK.STEEL_DARK);
    }
  }

  /* ---- keep only what can be seen ------------------------------------ */

  const visible: Cell[] = [];
  for (const [id, block] of solid) {
    const [x, y, z] = id.split(",").map(Number);
    const exposed =
      !solid.has(key(x + 1, y, z)) ||
      !solid.has(key(x - 1, y, z)) ||
      !solid.has(key(x, y + 1, z)) ||
      !solid.has(key(x, y - 1, z)) ||
      !solid.has(key(x, y, z + 1)) ||
      !solid.has(key(x, y, z - 1));
    if (exposed) visible.push({ x, y, z, block });
  }

  return visible;
}

export default function HeroDiorama({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 1, 400);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    scene.add(new THREE.HemisphereLight(0xa8c4e0, 0x241a12, 1.15));

    const sun = new THREE.DirectionalLight(0xffcf9b, 1.05);
    sun.position.set(6, 10, 4);
    scene.add(sun);

    const rim = new THREE.DirectionalLight(0x4a7fb5, 0.5);
    rim.position.set(-7, 3, -6);
    scene.add(rim);

    /* ---- island ------------------------------------------------------ */

    const cells = buildIsland(0x5354_5241);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshLambertMaterial({ vertexColors: false });
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(cells.length * 3),
      3
    );

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const jitterRng = new Rng(99);

    cells.forEach((cell, i) => {
      matrix.makeTranslation(cell.x, cell.y, cell.z);
      mesh.setMatrixAt(i, matrix);

      const def = blockDef(cell.block);
      // Same per-voxel colour jitter the real mesher applies, so the island
      // has the same grain as the in-game world.
      const jitter = 1 + (jitterRng.float() - 0.5) * 2 * def.jitter;
      const boost = 1 + def.emissive * 0.9;
      color.setRGB(
        Math.min(1, def.color[0] * jitter * boost),
        Math.min(1, def.color[1] * jitter * boost),
        Math.min(1, def.color[2] * jitter * boost)
      );
      mesh.instanceColor!.setXYZ(i, color.r, color.g, color.b);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    const pivot = new THREE.Group();
    pivot.add(mesh);
    scene.add(pivot);

    /* ---- frame ------------------------------------------------------- */

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Pull back on narrow viewports so the island never crops.
      camera.position.set(0, 14, width < 620 ? 48 : 40);
      camera.lookAt(0, 1, 0);
      camera.updateProjectionMatrix();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let raf = 0;
    let time = 0;
    let visible = true;

    // Stop rendering when scrolled away — a marketing page has no business
    // holding a GPU at 60fps while someone reads the FAQ.
    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0.05 }
    );
    intersection.observe(container);

    const onVisibility = () => {
      visible = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(tick);

      if (!visible) return;

      if (!prefersReduced) {
        time += dt;
        pivot.rotation.y = time * 0.16;
        pivot.position.y = Math.sin(time * 0.7) * 0.5;
      } else {
        pivot.rotation.y = 0.6;
      }

      renderer.render(scene, camera);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
