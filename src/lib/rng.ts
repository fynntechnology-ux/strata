import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Deterministic randomness for STRATA.
 *
 * Two very different jobs live in this file, and they must not be confused:
 *
 *  1. `Rng` — fast, seeded, *cosmetic* randomness. Terrain, ore veins, ambient
 *     detail, NPC listing generation. Nothing of value depends on it, so a
 *     cheap 32-bit PRNG is fine. It only has to be stable across reloads so a
 *     player's claim looks the same every session.
 *
 *  2. `rollFromSeed` / `weightedPick` — *consequential* randomness. Pack
 *     contents, loot rarity. These decide what a player receives, so the exact
 *     arithmetic here is a spec that the on-chain Rust program has to
 *     reproduce byte-for-byte. That is why it is written in integers over
 *     SHA-256 output, with no floating point anywhere: `f64` rounding differs
 *     between platforms, `u64` does not.
 *
 * See docs/ONCHAIN.md for the commit-reveal scheme these feed into.
 */

/* ==========================================================================
   1. Cosmetic PRNG
   ========================================================================== */

/** xoshiro128** — small, fast, good distribution, no crypto claims. */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // SplitMix32 the scalar seed out into four words so nearby seeds
    // (chunk 0, chunk 1, ...) don't produce correlated streams.
    let z = seed >>> 0;
    const mix = () => {
      z = (z + 0x9e3779b9) >>> 0;
      let t = z;
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
      return (t ^ (t >>> 15)) >>> 0;
    };
    this.s0 = mix();
    this.s1 = mix();
    this.s2 = mix();
    this.s3 = mix();
  }

  /** Next raw uint32. */
  next(): number {
    const r = Math.imul(this.s1, 5) >>> 0;
    const rotated = ((r << 7) | (r >>> 25)) >>> 0;
    const result = Math.imul(rotated, 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;

    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0;

    return result >>> 0;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  bool(chance = 0.5): boolean {
    return this.float() < chance;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.float() * arr.length)];
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Stable string -> uint32 seed (FNV-1a). Used to seed a claim from a wallet. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* ==========================================================================
   2. Consequential randomness — must match the Rust program exactly
   ========================================================================== */

/**
 * Odds are expressed in *parts per million* rather than percentages or floats.
 *
 * A 0.35% mythic chance is 3_500 ppm. Integer weights mean the TypeScript
 * client and the Rust program land on identical results from identical seeds,
 * which is the whole point of publishing drop tables: anyone can recompute a
 * reveal and check we didn't lie about it.
 */
export const PPM = 1_000_000;

export interface WeightedEntry<T> {
  readonly value: T;
  /** Parts per million. All entries in a table must sum to exactly 1_000_000. */
  readonly ppm: number;
}

/**
 * Derive a uniformly distributed u64 from a seed and a draw index.
 *
 * Rust equivalent:
 *   let mut h = Sha256::new();
 *   h.update(seed);
 *   h.update(&(index as u32).to_le_bytes());
 *   let d = h.finalize();
 *   u64::from_be_bytes(d[0..8].try_into().unwrap())
 */
export function rollFromSeed(seed: Uint8Array, index: number): bigint {
  const idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, index >>> 0, true); // little-endian, matches Rust to_le_bytes
  const digest = sha256(concatBytes(seed, idx));
  return bytesToBigIntBE(digest.subarray(0, 8));
}

/** Map a raw u64 roll into [0, PPM). */
export function rollToPpm(roll: bigint): number {
  return Number(roll % BigInt(PPM));
}

/**
 * Pick an entry from a ppm-weighted table using a raw roll.
 *
 * Walks cumulative weights in declaration order — so the table's *order* is
 * part of the spec too. Reordering a drop table changes historical outcomes,
 * which is why the tables are versioned in `sim/packs.ts`.
 */
export function weightedPick<T>(table: readonly WeightedEntry<T>[], roll: bigint): T {
  const target = rollToPpm(roll);
  let cumulative = 0;
  for (const entry of table) {
    cumulative += entry.ppm;
    if (target < cumulative) return entry.value;
  }
  // Only reachable if a table doesn't sum to PPM; validated at module load.
  return table[table.length - 1].value;
}

/** Throws at import time if a drop table is malformed, rather than silently skewing odds. */
export function assertTableSums<T>(name: string, table: readonly WeightedEntry<T>[]): void {
  const total = table.reduce((n, e) => n + e.ppm, 0);
  if (total !== PPM) {
    throw new Error(
      `Drop table "${name}" sums to ${total} ppm, expected ${PPM}. ` +
        `Odds would be silently wrong — fix the table.`
    );
  }
}

/** Integer-only interpolation in [min, max] from a roll. Used for stat rolls. */
export function rollRange(roll: bigint, min: number, max: number): number {
  if (max <= min) return min;
  const span = BigInt(max - min + 1);
  return min + Number(roll % span);
}

/* ==========================================================================
   Byte helpers
   ========================================================================== */

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Cryptographically random bytes — used for the client half of a commit. */
export function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export { sha256 };

/* ==========================================================================
   base58 — Solana's address/signature encoding.
   Needed so simulated signatures are shaped exactly like real ones and the UI
   can't develop a dependency on mock-only formatting.
   ========================================================================== */

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "";
  // Preserve leading zero bytes as '1' characters.
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}
