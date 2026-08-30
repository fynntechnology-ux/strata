import { COLOR_B, COLOR_G, COLOR_R, EMISSIVE, IS_SOLID, IS_TRANSPARENT, JITTER } from "./blocks";
import { CHUNK, H, W, chunkOrigin, idx } from "./coords";

/**
 * Chunk meshing.
 *
 * STRATA has no textures, so everything that makes the world look like
 * anything happens here. Three effects do the work, and they compound:
 *
 *  1. **Directional face shading.** A fixed brightness per face direction.
 *     Costs nothing and is most of why a cube reads as a cube.
 *  2. **Per-vertex ambient occlusion.** The dark creases where blocks meet.
 *     This is the single biggest visual upgrade available to a voxel renderer
 *     and it is entirely free at runtime — it bakes into the vertex colours.
 *  3. **Per-voxel colour jitter.** A hash-driven nudge to each voxel's colour.
 *     Without it, a wall of 400 stone blocks is one flat grey rectangle; with
 *     it, the same wall reads as rock.
 *
 * Output is indexed geometry: four vertices and six indices per quad rather
 * than six vertices, which is a third less data over the bus.
 */

/* ==========================================================================
   Face table

   Corner winding is counter-clockwise viewed from outside the block, so
   front-face culling works with the default material settings.
   ========================================================================== */

interface Face {
  normal: readonly [number, number, number];
  corners: ReadonlyArray<readonly [number, number, number]>;
  shade: number;
}

const FACES: readonly Face[] = [
  {
    // +X
    normal: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
    shade: 0.86,
  },
  {
    // -X
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    shade: 0.72,
  },
  {
    // +Y (top) — the reference brightness everything else is relative to
    normal: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    shade: 1.0,
  },
  {
    // -Y (bottom)
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    shade: 0.5,
  },
  {
    // +Z
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    shade: 0.8,
  },
  {
    // -Z
    normal: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    shade: 0.66,
  },
];

/**
 * Ambient-occlusion sample offsets, derived once at module load.
 *
 * For a given face and corner, the three voxels that can shadow it are the two
 * edge-adjacent neighbours and the diagonal, all offset one step along the
 * face normal. Deriving them from the corner table rather than hardcoding 72
 * triples means the winding table above stays the only thing to get right.
 */
const AO_OFFSETS: Int8Array[] = FACES.map((face) => {
  const out = new Int8Array(4 * 3 * 3); // 4 corners x 3 samples x xyz
  const n = face.normal;
  // The two axes the face spans are the ones the normal is zero on.
  const tangents = [0, 1, 2].filter((axis) => n[axis] === 0);

  face.corners.forEach((corner, ci) => {
    const [a1, a2] = tangents;
    const s1 = corner[a1] === 1 ? 1 : -1;
    const s2 = corner[a2] === 1 ? 1 : -1;

    const samples: number[][] = [
      [n[0], n[1], n[2]],
      [n[0], n[1], n[2]],
      [n[0], n[1], n[2]],
    ];
    samples[0][a1] += s1; // side 1
    samples[1][a2] += s2; // side 2
    samples[2][a1] += s1; // diagonal corner
    samples[2][a2] += s2;

    for (let si = 0; si < 3; si++) {
      for (let axis = 0; axis < 3; axis++) {
        out[ci * 9 + si * 3 + axis] = samples[si][axis];
      }
    }
  });

  return out;
});

/** AO level 0-3 mapped to a brightness multiplier. */
const AO_BRIGHTNESS = [0.38, 0.6, 0.8, 1.0];

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

/* ==========================================================================
   Scratch buffers

   Meshing runs on every edit, so the buffers are module-level and reused. A
   fresh allocation per chunk would hand the GC several megabytes a second
   while a player is holding the mouse down on a block.
   ========================================================================== */

let capacity = 1 << 16;
let sPositions = new Float32Array(capacity * 3);
let sNormals = new Float32Array(capacity * 3);
let sColors = new Float32Array(capacity * 3);
let sIndices = new Uint32Array(capacity * 6);

function ensureCapacity(vertices: number): void {
  if (vertices <= capacity) return;
  while (capacity < vertices) capacity *= 2;
  sPositions = new Float32Array(capacity * 3);
  sNormals = new Float32Array(capacity * 3);
  sColors = new Float32Array(capacity * 3);
  sIndices = new Uint32Array(capacity * 6);
}

/** Cheap integer hash — stable per voxel, so jitter doesn't crawl on re-mesh. */
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Reads a voxel, treating out-of-bounds as air except below the world floor.
 *
 * Air at the horizontal edges is deliberate: it makes the claim boundary
 * render as an exposed cross-section of the strata, which both looks good and
 * tells the player at a glance what is under their feet.
 */
function sample(data: Uint8Array, x: number, y: number, z: number): number {
  if (y < 0) return 1; // solid floor, so the world bottom isn't meshed
  if (x < 0 || x >= W || y >= H || z < 0 || z >= W) return 0;
  return data[y + H * (x + W * z)];
}

export function meshChunk(data: Uint8Array, chunkIdx: number): ChunkMesh | null {
  const [ox, oy, oz] = chunkOrigin(chunkIdx);
  const maxX = Math.min(ox + CHUNK, W);
  const maxY = Math.min(oy + CHUNK, H);
  const maxZ = Math.min(oz + CHUNK, W);

  // Worst case: every voxel emits all six faces.
  ensureCapacity(CHUNK * CHUNK * CHUNK * 6 * 4);

  let vertex = 0;
  let index = 0;

  for (let z = oz; z < maxZ; z++) {
    for (let x = ox; x < maxX; x++) {
      const column = H * (x + W * z);

      for (let y = oy; y < maxY; y++) {
        const id = data[column + y];
        if (id === 0 || !IS_SOLID[id]) continue;

        const emissive = EMISSIVE[id];
        const jitterAmount = JITTER[id];
        const jitter =
          jitterAmount === 0 ? 1 : 1 + (hash3(x, y, z) - 0.5) * 2 * jitterAmount;

        const baseR = COLOR_R[id] * jitter;
        const baseG = COLOR_G[id] * jitter;
        const baseB = COLOR_B[id] * jitter;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.normal[0];
          const ny = y + face.normal[1];
          const nz = z + face.normal[2];

          const neighbor = sample(data, nx, ny, nz);
          // Solid opaque neighbours hide the face. Transparent ones only hide
          // it when they're the same block, so glass panes don't self-stripe.
          if (IS_SOLID[neighbor] && (!IS_TRANSPARENT[neighbor] || neighbor === id)) {
            continue;
          }

          const offsets = AO_OFFSETS[f];
          const ao = [0, 0, 0, 0];

          for (let c = 0; c < 4; c++) {
            if (emissive >= 0.85) {
              // Self-lit blocks read as light sources, not shadowed geometry.
              ao[c] = 3;
              continue;
            }
            const b = c * 9;
            const s1 = IS_SOLID[
              sample(data, x + offsets[b], y + offsets[b + 1], z + offsets[b + 2])
            ];
            const s2 = IS_SOLID[
              sample(data, x + offsets[b + 3], y + offsets[b + 4], z + offsets[b + 5])
            ];
            const cr = IS_SOLID[
              sample(data, x + offsets[b + 6], y + offsets[b + 7], z + offsets[b + 8])
            ];
            ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
          }

          const first = vertex;

          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            const p = vertex * 3;

            sPositions[p] = x + corner[0];
            sPositions[p + 1] = y + corner[1];
            sPositions[p + 2] = z + corner[2];

            sNormals[p] = face.normal[0];
            sNormals[p + 1] = face.normal[1];
            sNormals[p + 2] = face.normal[2];

            // Emissive blocks ignore both AO and face shading so they stay
            // uniformly bright — a lamp lit from one side looks broken.
            const light =
              emissive > 0
                ? face.shade * (1 - emissive) + emissive
                : face.shade * AO_BRIGHTNESS[ao[c]];
            const boost = 1 + emissive * 0.55;

            sColors[p] = Math.min(1, baseR * light * boost);
            sColors[p + 1] = Math.min(1, baseG * light * boost);
            sColors[p + 2] = Math.min(1, baseB * light * boost);

            vertex++;
          }

          // Split the quad along its brighter diagonal. Without this, the AO
          // gradient across a corner bends visibly along the shared edge.
          if (ao[0] + ao[2] > ao[1] + ao[3]) {
            sIndices[index++] = first + 1;
            sIndices[index++] = first + 2;
            sIndices[index++] = first + 3;
            sIndices[index++] = first + 1;
            sIndices[index++] = first + 3;
            sIndices[index++] = first;
          } else {
            sIndices[index++] = first;
            sIndices[index++] = first + 1;
            sIndices[index++] = first + 2;
            sIndices[index++] = first;
            sIndices[index++] = first + 2;
            sIndices[index++] = first + 3;
          }
        }
      }
    }
  }

  if (vertex === 0) return null;

  return {
    positions: sPositions.slice(0, vertex * 3),
    normals: sNormals.slice(0, vertex * 3),
    colors: sColors.slice(0, vertex * 3),
    indices: sIndices.slice(0, index),
    vertexCount: vertex,
    indexCount: index,
  };
}

/** Debug helper: how many faces a chunk would emit, without building buffers. */
export function countFaces(data: Uint8Array, chunkIdx: number): number {
  const [ox, oy, oz] = chunkOrigin(chunkIdx);
  let faces = 0;

  for (let z = oz; z < Math.min(oz + CHUNK, W); z++) {
    for (let x = ox; x < Math.min(ox + CHUNK, W); x++) {
      for (let y = oy; y < Math.min(oy + CHUNK, H); y++) {
        const id = data[idx(x, y, z)];
        if (!IS_SOLID[id]) continue;
        for (const face of FACES) {
          const neighbor = sample(data, x + face.normal[0], y + face.normal[1], z + face.normal[2]);
          if (!IS_SOLID[neighbor] || (IS_TRANSPARENT[neighbor] && neighbor !== id)) faces++;
        }
      }
    }
  }

  return faces;
}
