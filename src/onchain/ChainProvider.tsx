"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ChainAdapter } from "./adapter";
import { resolveChainMode } from "./adapter";
import { MockChainAdapter } from "./mock/MockChainAdapter";
import type { GameConfig, WalletInfo, WalletState } from "./types";

/**
 * Chooses and provides the chain adapter.
 *
 * The adapter is built in an effect rather than during render for two reasons:
 * it reads `localStorage` and enumerates browser wallet extensions, neither of
 * which exists during server rendering, and the Solana implementation is
 * loaded lazily so its RPC client never enters the landing page's bundle.
 */

interface ChainContextValue {
  /** Null until the client has mounted. Every consumer must handle that. */
  adapter: ChainAdapter | null;
  ready: boolean;
  mode: string;
  label: string;
  simulated: boolean;
  wallet: WalletState;
  wallets: WalletInfo[];
  config: GameConfig | null;
  connect: (walletName?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshWallets: () => void;
}

const ChainContext = createContext<ChainContextValue | null>(null);

const DISCONNECTED: WalletState = { status: "disconnected", address: null, walletName: null };

/**
 * Resolved once at module load rather than per render.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so this cannot change while
 * the app is running — holding it in a ref only made it look like it might.
 */
const CHAIN_MODE = resolveChainMode();

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const [adapter, setAdapter] = useState<ChainAdapter | null>(null);
  const [wallet, setWallet] = useState<WalletState>(DISCONNECTED);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [config, setConfig] = useState<GameConfig | null>(null);

  useEffect(() => {
    let disposed = false;
    let instance: ChainAdapter | null = null;

    async function boot() {
      const selected = CHAIN_MODE;

      if (selected === "mock") {
        instance = new MockChainAdapter();
      } else {
        // Loaded only when actually targeting a cluster, so the RPC client and
        // its dependencies stay out of the default bundle.
        const { SolanaChainAdapter } = await import("./solana/SolanaChainAdapter");
        instance = new SolanaChainAdapter(selected);
      }

      if (disposed) {
        (instance as { dispose?: () => void }).dispose?.();
        return;
      }

      setAdapter(instance);
      setWallets(instance.listWallets());
      setWallet(instance.getWalletState());

      const unsubscribe = instance.onWalletChange((next) => {
        setWallet(next);
        setWallets(instance!.listWallets());
      });

      instance
        .getConfig()
        .then((value) => {
          if (!disposed) setConfig(value);
        })
        .catch(() => {
          // Expected before the programs are deployed. The UI reads
          // `simulated` and its own defaults rather than depending on config.
        });

      return unsubscribe;
    }

    const pending = boot();

    return () => {
      disposed = true;
      pending.then((unsubscribe) => unsubscribe?.()).catch(() => {});
      (instance as { dispose?: () => void } | null)?.dispose?.();
    };
  }, []);

  const connect = useCallback(
    async (walletName?: string) => {
      if (!adapter) return;
      await adapter.connect(walletName);
    },
    [adapter]
  );

  const disconnect = useCallback(async () => {
    if (!adapter) return;
    await adapter.disconnect();
  }, [adapter]);

  const refreshWallets = useCallback(() => {
    if (adapter) setWallets(adapter.listWallets());
  }, [adapter]);

  const value = useMemo<ChainContextValue>(
    () => ({
      adapter,
      ready: adapter !== null,
      mode: CHAIN_MODE,
      label: adapter?.label ?? "Simulated",
      simulated: (adapter?.kind ?? "mock") === "mock",
      wallet,
      wallets,
      config,
      connect,
      disconnect,
      refreshWallets,
    }),
    [adapter, wallet, wallets, config, connect, disconnect, refreshWallets]
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain(): ChainContextValue {
  const context = useContext(ChainContext);
  if (!context) {
    throw new Error("useChain must be used inside <ChainProvider>");
  }
  return context;
}

/** Throws if called before the adapter exists — for event handlers only. */
export function useAdapter(): ChainAdapter {
  const { adapter } = useChain();
  if (!adapter) throw new Error("Chain adapter is not ready yet");
  return adapter;
}
