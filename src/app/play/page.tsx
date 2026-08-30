"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Engine, EngineStats, HoverInfo } from "@/game/engine";
import { GameCanvas } from "@/ui/game/GameCanvas";
import { Hud } from "@/ui/game/Hud";
import { PackReveal } from "@/ui/game/PackReveal";
import { Toasts } from "@/ui/game/Toasts";
import { PanelHost } from "@/ui/game/panels";
import { useChain } from "@/onchain/ChainProvider";
import { MockChainAdapter } from "@/onchain/mock/MockChainAdapter";
import { useGame } from "@/sim/store";
import { Button, Spinner } from "@/ui/primitives";
import { IconPick, IconWallet } from "@/ui/icons";
import { Logo } from "@/ui/site/SiteChrome";

/**
 * The game shell.
 *
 * Owns the sequence: pick a wallet, load the claim, hand a seed to the engine.
 * Everything after that is the engine's own loop and the store's reaction to
 * it — this component re-renders only when the phase changes.
 */
export default function PlayPage() {
  const { adapter, ready, wallet, connect, simulated } = useChain();
  const snapshot = useGame((s) => s.snapshot);
  const loading = useGame((s) => s.loading);
  const hydrate = useGame((s) => s.hydrate);
  const reset = useGame((s) => s.reset);
  const stats = useGame((s) => s.stats);
  const buildings = useGame((s) => s.snapshot?.buildings);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [engineStats, setEngineStats] = useState<EngineStats | null>(null);
  const hydratedFor = useRef<string | null>(null);

  /* ---- load the claim once per address ------------------------------- */
  useEffect(() => {
    if (!adapter) return;

    if (wallet.status !== "connected" || !wallet.address) {
      hydratedFor.current = null;
      reset();
      return;
    }

    if (hydratedFor.current === wallet.address) return;
    hydratedFor.current = wallet.address;
    void hydrate(adapter, wallet.address);
  }, [adapter, wallet.status, wallet.address, hydrate, reset]);

  /* ---- keep the engine in step with the store ------------------------ */
  useEffect(() => {
    if (!engine) return;
    const hasScanner = (snapshot?.items ?? []).some(
      (item) => item.slot === "scanner" && item.equipped
    );
    engine.setStats(stats, hasScanner);
  }, [engine, stats, snapshot?.items]);

  useEffect(() => {
    if (!engine || !buildings) return;
    engine.syncBuildings(buildings);
  }, [engine, buildings]);

  /* ---- commit mined resources in batches ----------------------------- */
  useEffect(() => {
    if (!adapter || !snapshot) return;

    const timer = setInterval(() => {
      void useGame.getState().flushMining(adapter);
    }, 4_000);

    // Flush on the way out too, so closing a tab doesn't drop the last haul.
    const onHide = () => {
      if (document.visibilityState === "hidden") void useGame.getState().flushMining(adapter);
    };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [adapter, snapshot]);

  /* ---- refresh passive yield projection ------------------------------ */
  useEffect(() => {
    if (!adapter || !snapshot) return;
    const timer = setInterval(() => {
      void useGame.getState().refresh(adapter);
    }, 20_000);
    return () => clearInterval(timer);
  }, [adapter, snapshot]);

  if (!ready) {
    return <Splash>{null}</Splash>;
  }

  if (wallet.status !== "connected") {
    return (
      <Splash>
        <div className="text-center">
          <Logo size={40} withText={false} />
          <h1 className="mt-5 font-display text-3xl tracking-[-0.02em]">Claim your ground</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-body">
            Your claim is generated from an address, so the same terrain comes back every time.
            {simulated && " Nothing is signed and no transaction is ever sent."}
          </p>

          <div className="mt-8 flex flex-col gap-2.5">
            <Button
              variant="primary"
              size="lg"
              icon={<IconPick size={16} />}
              loading={wallet.status === "connecting"}
              onClick={() => void connect(MockChainAdapter.DEMO_WALLET)}
            >
              Play now — no wallet
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={<IconWallet size={16} />}
              onClick={() => void connect()}
            >
              Use a Solana wallet
            </Button>
          </div>

          <Link
            href="/"
            className="mt-6 inline-block text-xs text-mute transition-colors hover:text-body"
          >
            ← Back to the site
          </Link>
        </div>
      </Splash>
    );
  }

  if (loading || !snapshot) {
    return (
      <Splash>
        <div className="flex flex-col items-center gap-4 text-mute">
          <Spinner size={22} />
          <p className="text-sm">Reading your claim…</p>
        </div>
      </Splash>
    );
  }

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-void">
      <GameCanvas
        claimSeed={snapshot.player.claimSeed}
        onHover={setHover}
        onStats={setEngineStats}
        onReady={setEngine}
      />
      <Hud engine={engine} hover={hover} stats={engineStats} />
      <PanelHost />
      <Toasts />
      <PackReveal />
      {/* Only once the world is actually on screen — a controls legend over a
          loading bar is just something in the way. */}
      {engine && <FirstRunHint />}
    </main>
  );
}

/* ==========================================================================
   Chrome
   ========================================================================== */

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-void px-6">
      <div className="vx-grid pointer-events-none absolute inset-0 opacity-[0.14]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,color-mix(in_oklab,var(--color-amber)_11%,transparent),transparent_62%)]" />
      <div className="relative w-full max-w-md">{children}</div>
    </main>
  );
}

const noSubscribe = () => () => {};

/**
 * Reads a browser-only flag without a hydration mismatch.
 *
 * `useState` + an effect would work but writes state synchronously on mount;
 * `useSyncExternalStore` expresses the same thing as what it actually is — a
 * read of external state — and lets the server snapshot differ deliberately.
 * The server assumes "already seen" so the hint never appears in prerendered
 * markup and then vanish for returning players.
 */
function useSeenControls(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => {
      try {
        return window.localStorage.getItem("strata:seen-controls") === "1";
      } catch {
        return false;
      }
    },
    () => true
  );
}

/**
 * Controls hint.
 *
 * An RTS camera on a page most people arrive at from a link needs a legend, but
 * only once — after that it is noise.
 */
function FirstRunHint() {
  const seen = useSeenControls();
  const [dismissed, setDismissed] = useState(false);

  if (seen || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem("strata:seen-controls", "1");
    } catch {
      /* private mode — the hint just comes back next time */
    }
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/2 z-30 w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4">
      <div className="vx-panel vx-ticks animate-rise p-5">
        <h2 className="font-display text-sm uppercase tracking-[0.12em] text-hi">Controls</h2>
        <dl className="mt-4 space-y-2 text-[12px]">
          {[
            ["Left click + hold", "Mine the block under the cursor"],
            ["Right drag", "Orbit the camera"],
            ["Middle drag / Shift+drag", "Pan"],
            ["Scroll", "Zoom"],
            ["W A S D", "Move focus · Q E rotate · R F raise and lower"],
          ].map(([key, value]) => (
            <div key={key} className="flex gap-3">
              <dt className="w-44 shrink-0 text-mute">{key}</dt>
              <dd className="text-body">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[11px] leading-relaxed text-faint">
          Energy limits how much you can mine at once and refills on its own. When it runs low,
          build something instead.
        </p>
        <Button variant="primary" full className="mt-4" onClick={dismiss}>
          Start digging
        </Button>
      </div>
    </div>
  );
}
