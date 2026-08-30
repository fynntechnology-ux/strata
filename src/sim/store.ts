"use client";

import { create } from "zustand";
import type { ChainAdapter } from "@/onchain/adapter";
import {
  ChainError,
  formatToken,
  toRaw,
  type Address,
  type ItemInstance,
  type PackReveal,
  type PlacedBuilding,
  type PlayerSnapshot,
  type Raw,
} from "@/onchain/types";
import type { MineEvent } from "@/game/engine";
import {
  aggregateItemStats,
  deriveCityStats,
  derivePlayerStats,
  levelFromXp,
  type CityStats,
  type PlayerStats,
} from "./economy";
import { bagAdd, bagTotal } from "./resources";
import type { BuildingKind, PackKind, ResourceBag, ResourceKind } from "./types";

/**
 * Client game state.
 *
 * Three kinds of state live here and they behave differently:
 *
 *  - **Chain state** (`snapshot`) is authoritative and read-only. It is only
 *    ever replaced wholesale by a fresh read.
 *  - **Pending state** (`pendingMined`, `pendingEnergy`) is work the player
 *    has done that hasn't been committed yet. Hand mining batches rather than
 *    writing per block, because one transaction per swing is absurd on any
 *    chain and would feel awful even off one.
 *  - **UI state** is panels and toasts, and never persists.
 *
 * Everything derived — stats, level, city totals — is recomputed when the
 * snapshot changes rather than stored twice.
 */

export type PanelId =
  | null
  | "inventory"
  | "city"
  | "packs"
  | "market"
  | "sell"
  | "stake"
  | "leaderboard"
  | "settings";

export interface Toast {
  id: string;
  kind: "success" | "error" | "info" | "reward";
  title: string;
  message?: string;
  signature?: string;
  at: number;
}

interface GameState {
  /* ---- chain ---- */
  address: Address | null;
  snapshot: PlayerSnapshot | null;
  loading: boolean;
  /** Names of in-flight operations, so buttons can show their own spinners. */
  busy: Set<string>;

  /* ---- derived ---- */
  stats: PlayerStats;
  city: CityStats;
  level: { level: number; into: number; needed: number };

  /* ---- pending ---- */
  pendingMined: ResourceBag;
  pendingEnergy: number;
  /** Fractional yield carried between blocks so bonuses aren't rounded away. */
  yieldCarry: Partial<Record<ResourceKind, number>>;
  blocksMined: number;

  /* ---- ui ---- */
  panel: PanelId;
  buildKind: BuildingKind | null;
  toasts: Toast[];
  revealing: PackReveal | null;

  /* ---- actions ---- */
  hydrate: (adapter: ChainAdapter, address: Address) => Promise<void>;
  refresh: (adapter: ChainAdapter) => Promise<void>;
  applyMine: (event: MineEvent) => void;
  flushMining: (adapter: ChainAdapter) => Promise<void>;
  run: <T>(
    key: string,
    action: () => Promise<T>,
    success?: (result: T) => Omit<Toast, "id" | "at"> | null
  ) => Promise<T | null>;
  setPanel: (panel: PanelId) => void;
  setBuildKind: (kind: BuildingKind | null) => void;
  pushToast: (toast: Omit<Toast, "id" | "at">) => void;
  dismissToast: (id: string) => void;
  setRevealing: (reveal: PackReveal | null) => void;
  reset: () => void;
}

const EMPTY_STATS: PlayerStats = {
  energyMax: 100,
  energyRegen: 2.4,
  miningSpeed: 0,
  yieldBonus: 0,
  energyCost: 0,
  extractorRate: 0,
  luck: 0,
  refineSpeed: 0,
};

const EMPTY_CITY = deriveCityStats([]);

/** Hand mining commits when either threshold trips, whichever comes first. */
export const MINING_FLUSH_UNITS = 30;
export const MINING_FLUSH_MS = 12_000;

let lastFlushAt = Date.now();

export const useGame = create<GameState>((set, get) => ({
  address: null,
  snapshot: null,
  loading: false,
  busy: new Set(),

  stats: EMPTY_STATS,
  city: EMPTY_CITY,
  level: { level: 1, into: 0, needed: 120 },

  pendingMined: {},
  pendingEnergy: 0,
  yieldCarry: {},
  blocksMined: 0,

  panel: null,
  buildKind: null,
  toasts: [],
  revealing: null,

  /* ======================================================================
     Loading
     ====================================================================== */

  async hydrate(adapter, address) {
    set({ loading: true, address });
    try {
      let snapshot = await adapter.getSnapshot(address);
      if (!snapshot) {
        // First visit for this wallet — register the claim.
        const receipt = await adapter.initPlayer();
        snapshot = receipt.data;
      }
      applySnapshot(set, snapshot);
    } catch (error) {
      get().pushToast({
        kind: "error",
        title: "Couldn't load your claim",
        message: describeError(error),
      });
    } finally {
      set({ loading: false });
    }
  },

  async refresh(adapter) {
    const address = get().address;
    if (!address) return;
    const snapshot = await adapter.getSnapshot(address);
    if (snapshot) applySnapshot(set, snapshot);
  },

  /* ======================================================================
     Mining

     Accumulated locally, committed in batches. `yieldCarry` holds the
     fractional part of each yield so a +37% bonus reliably produces an extra
     unit roughly every third block instead of being truncated to nothing.
     ====================================================================== */

  applyMine(event) {
    const state = get();

    set({
      pendingEnergy: state.pendingEnergy + event.energySpent,
      blocksMined: state.blocksMined + 1,
    });

    if (!event.resource || event.amount <= 0) return;

    const carry = { ...state.yieldCarry };
    const total = (carry[event.resource] ?? 0) + event.amount;
    const whole = Math.floor(total);
    carry[event.resource] = total - whole;

    const mined = { ...state.pendingMined };
    if (whole > 0) bagAdd(mined, event.resource, whole);

    set({ pendingMined: mined, yieldCarry: carry });
  },

  async flushMining(adapter) {
    const { pendingMined, pendingEnergy, address } = get();
    if (!address) return;

    const units = bagTotal(pendingMined);
    const elapsed = Date.now() - lastFlushAt;
    if (units === 0 && pendingEnergy <= 0) return;
    if (units < MINING_FLUSH_UNITS && elapsed < MINING_FLUSH_MS) return;

    // Clear optimistically so mining continues accumulating during the call.
    set({ pendingMined: {}, pendingEnergy: 0 });
    lastFlushAt = Date.now();

    try {
      await adapter.settleMining(pendingMined, pendingEnergy);
      await get().refresh(adapter);
    } catch (error) {
      // Put it back — losing a batch to a transient failure would be theft.
      const current = get();
      const restored = { ...current.pendingMined };
      for (const [kind, qty] of Object.entries(pendingMined) as [ResourceKind, number][]) {
        bagAdd(restored, kind, qty ?? 0);
      }
      set({
        pendingMined: restored,
        pendingEnergy: current.pendingEnergy + pendingEnergy,
      });

      if (error instanceof ChainError && !error.recoverable) {
        get().pushToast({
          kind: "error",
          title: "Mining batch rejected",
          message: error.message,
        });
        set({ pendingMined: {}, pendingEnergy: 0 });
      }
    }
  },

  /* ======================================================================
     Generic transaction runner

     Every mutating call goes through this so busy state, error surfacing and
     post-transaction refresh are handled once instead of at 15 call sites.
     ====================================================================== */

  async run(key, action, success) {
    const state = get();
    if (state.busy.has(key)) return null;

    set({ busy: new Set(state.busy).add(key) });

    try {
      const result = await action();
      const toast = success?.(result);
      if (toast) get().pushToast(toast);
      return result;
    } catch (error) {
      get().pushToast({
        kind: "error",
        title: "Transaction failed",
        message: describeError(error),
      });
      return null;
    } finally {
      const busy = new Set(get().busy);
      busy.delete(key);
      set({ busy });
    }
  },

  /* ======================================================================
     UI
     ====================================================================== */

  setPanel(panel) {
    set({ panel });
  },

  setBuildKind(kind) {
    set({ buildKind: kind });
  },

  pushToast(toast) {
    const entry: Toast = {
      ...toast,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
    };
    set({ toasts: [entry, ...get().toasts].slice(0, 4) });

    const ttl = toast.kind === "error" ? 7_000 : 4_200;
    setTimeout(() => get().dismissToast(entry.id), ttl);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setRevealing(reveal) {
    set({ revealing: reveal });
  },

  reset() {
    set({
      address: null,
      snapshot: null,
      stats: EMPTY_STATS,
      city: EMPTY_CITY,
      level: { level: 1, into: 0, needed: 120 },
      pendingMined: {},
      pendingEnergy: 0,
      yieldCarry: {},
      blocksMined: 0,
      panel: null,
      buildKind: null,
      toasts: [],
      revealing: null,
    });
  },
}));

/* ==========================================================================
   Derivation
   ========================================================================== */

function applySnapshot(
  set: (partial: Partial<GameState>) => void,
  snapshot: PlayerSnapshot
): void {
  const city = deriveCityStats(snapshot.buildings);
  const itemStats = aggregateItemStats(snapshot.items);
  const level = levelFromXp(snapshot.player.xp);
  const stats = derivePlayerStats(itemStats, city, level.level);

  set({ snapshot, city, stats, level });
}

function describeError(error: unknown): string {
  if (error instanceof ChainError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

/* ==========================================================================
   Selectors

   Components subscribe to the narrowest slice they need. Zustand re-renders on
   reference change, so returning a fresh object from a selector would re-render
   every frame — these all return primitives or stable references.
   ========================================================================== */

export const selectBalance = (state: GameState): Raw => state.snapshot?.balance ?? 0n;
export const selectResources = (state: GameState): ResourceBag => state.snapshot?.resources ?? {};
export const selectItems = (state: GameState): ItemInstance[] => state.snapshot?.items ?? [];
export const selectBuildings = (state: GameState): PlacedBuilding[] =>
  state.snapshot?.buildings ?? [];
export const selectPending = (state: GameState): ResourceBag => state.snapshot?.pendingYield ?? {};
export const selectIsBusy = (key: string) => (state: GameState) => state.busy.has(key);

/** Equipped item in a slot, or null. */
export function equippedIn(items: readonly ItemInstance[], slot: string): ItemInstance | null {
  return items.find((item) => item.slot === slot && item.equipped) ?? null;
}

/** Convenience for buttons that need "can I afford this?" without a round trip. */
export function canAffordTokens(balance: Raw, tokens: number): boolean {
  return balance >= toRaw(tokens);
}

export { formatToken };
export type { PackKind };
