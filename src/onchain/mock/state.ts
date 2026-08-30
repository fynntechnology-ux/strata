import type {
  Address,
  ChainEvent,
  ItemInstance,
  Listing,
  Offer,
  PlacedBuilding,
  PlayerAccount,
  StakePosition,
} from "../types";
import type { PackKind, ResourceBag } from "@/sim/types";

/**
 * Persistence for the simulated chain.
 *
 * Everything lives in `localStorage` under a versioned key. The version is in
 * the key rather than inside the payload so a breaking change to the shape is
 * a clean start rather than a migration — this is a simulation, and there is
 * no user data here worth migrating.
 *
 * The one non-obvious problem is `bigint`. Token balances are bigints, and
 * `JSON.stringify` throws on them rather than doing something reasonable. The
 * codec below tags them so they round-trip exactly; silently going through
 * `Number` would lose precision on large balances, which is exactly the bug
 * this whole codebase avoids by using bigint in the first place.
 */

export const STORAGE_VERSION = 1;
const KEY_PREFIX = `strata:mock:v${STORAGE_VERSION}`;

export const KEYS = {
  demoWallet: `${KEY_PREFIX}:demo-wallet`,
  global: `${KEY_PREFIX}:global`,
  player: (address: string) => `${KEY_PREFIX}:player:${address}`,
} as const;

/* ==========================================================================
   Shapes
   ========================================================================== */

/**
 * A commit, including the client secret.
 *
 * In a real deployment this secret never leaves the player's device until the
 * reveal transaction — that is the entire security property. Keeping it in
 * local storage here mirrors that: the "chain" side of the mock only ever sees
 * the hash until reveal.
 */
export interface StoredCommit {
  id: string;
  owner: Address;
  kind: PackKind;
  nonce: number;
  clientSeedHex: string;
  clientSeedHashHex: string;
  committedSlot: number;
  committedAt: number;
  revealed: boolean;
  revealSignature: string | null;
}

export interface MockPlayerState {
  player: PlayerAccount;
  /** Base units, serialised as a decimal string. */
  balance: bigint;
  resources: ResourceBag;
  items: ItemInstance[];
  buildings: PlacedBuilding[];
  stake: StakePosition | null;
  commits: StoredCommit[];
  /** Energy is stored as a value plus a timestamp, never ticked. */
  energy: { value: number; at: number };
  /** Fractional mining yield carried between blocks so bonuses aren't lost. */
  yieldCarry: number;
  nextNonce: number;
}

export interface MockGlobalState {
  listings: Listing[];
  offers: Offer[];
  events: ChainEvent[];
  syntheticSeeded: boolean;
  /** Wall-clock ms when synthetic market activity was last advanced. */
  lastMarketTick: number;
}

/* ==========================================================================
   JSON codec with bigint support
   ========================================================================== */

const BIGINT_TAG = "__bigint__";

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { [BIGINT_TAG]: value.toString() };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    BIGINT_TAG in (value as Record<string, unknown>)
  ) {
    return BigInt((value as Record<string, string>)[BIGINT_TAG]);
  }
  return value;
}

export function encode(value: unknown): string {
  return JSON.stringify(value, replacer);
}

export function decode<T>(text: string): T {
  return JSON.parse(text, reviver) as T;
}

/* ==========================================================================
   Access

   Every read is defensive. Local storage can be unavailable (private mode,
   embedded webviews, storage-blocked iframes) or contain data written by an
   older build. Neither should be able to white-screen the game.
   ========================================================================== */

function hasStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const probe = "__strata_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** In-memory fallback so the game still runs when storage is blocked. */
const memoryStore = new Map<string, string>();

export function readKey(key: string): string | null {
  if (hasStorage()) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      /* fall through to memory */
    }
  }
  return memoryStore.get(key) ?? null;
}

export function writeKey(key: string, value: string): void {
  if (hasStorage()) {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch {
      // Quota exceeded, most likely. Keep playing from memory.
    }
  }
  memoryStore.set(key, value);
}

export function removeKey(key: string): void {
  if (hasStorage()) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  memoryStore.delete(key);
}

export function loadPlayer(address: Address): MockPlayerState | null {
  const raw = readKey(KEYS.player(address));
  if (!raw) return null;
  try {
    return decode<MockPlayerState>(raw);
  } catch {
    // Corrupt or stale shape — treat as a fresh player rather than crashing.
    removeKey(KEYS.player(address));
    return null;
  }
}

export function savePlayer(address: Address, state: MockPlayerState): void {
  writeKey(KEYS.player(address), encode(state));
}

export function loadGlobal(): MockGlobalState {
  const raw = readKey(KEYS.global);
  if (raw) {
    try {
      return decode<MockGlobalState>(raw);
    } catch {
      removeKey(KEYS.global);
    }
  }
  return { listings: [], offers: [], events: [], syntheticSeeded: false, lastMarketTick: 0 };
}

export function saveGlobal(state: MockGlobalState): void {
  // Keep the event log bounded; it is a ticker, not an archive.
  const trimmed: MockGlobalState = { ...state, events: state.events.slice(0, 200) };
  writeKey(KEYS.global, encode(trimmed));
}

/** Wipes all simulated state. Exposed in the UI as "Reset claim". */
export function resetAll(address?: Address): void {
  if (address) removeKey(KEYS.player(address));
  removeKey(KEYS.global);
  removeKey(KEYS.demoWallet);
}
