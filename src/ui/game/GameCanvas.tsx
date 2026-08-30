"use client";

import { useEffect, useRef, useState } from "react";
import { Engine, type EngineStats, type HoverInfo } from "@/game/engine";
import { useChain } from "@/onchain/ChainProvider";
import { useGame } from "@/sim/store";
import type { BuildingKind } from "@/sim/types";

/**
 * Hosts the engine and wires it to the store.
 *
 * The engine runs its own `requestAnimationFrame` loop and never re-renders
 * React. Data flows out through coarse callbacks (a block broke, the pointer
 * moved to a new block) and in through imperative setters. Anything that
 * changes every frame — energy, mining progress, FPS — is read from refs by
 * the HUD rather than pushed into React state.
 */

export interface GameCanvasProps {
  claimSeed: number;
  onHover: (info: HoverInfo | null) => void;
  onStats: (stats: EngineStats) => void;
  onReady: (engine: Engine) => void;
}

export function GameCanvas({ claimSeed, onHover, onStats, onReady }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [progress, setProgress] = useState({ value: 0, label: "Preparing" });
  const [ready, setReady] = useState(false);

  const { adapter } = useChain();

  // Held in a ref so the effect below can stay keyed only on the claim seed —
  // re-initialising the engine on every store change would regenerate the
  // entire world several times a second. Updated in an effect rather than
  // during render, because mutating a ref while rendering is not safe under
  // concurrent React.
  const handlers = useRef({ onHover, onStats, onReady });
  useEffect(() => {
    handlers.current = { onHover, onStats, onReady };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !adapter) return;

    // The canvas is created here rather than rendered by React, so every run
    // of this effect gets a brand new one. Reusing a single JSX canvas breaks
    // under StrictMode's mount/unmount/remount: the first engine disposes the
    // WebGL context, and because a canvas only ever hands out one context, the
    // second engine silently inherits the dead one and renders nothing.
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full touch-none select-none";
    container.appendChild(canvas);

    let disposed = false;
    const engine = new Engine();
    engineRef.current = engine;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      engine.resize(rect.width, rect.height);
    };

    engine
      .init(canvas, claimSeed, {
        onLoadProgress: (value, label) => {
          if (!disposed) setProgress({ value, label });
        },
        onReady: () => {
          if (disposed) return;
          resize();
          setReady(true);
          handlers.current.onReady(engine);
        },
        onHover: (info) => handlers.current.onHover(info),
        onStats: (stats) => handlers.current.onStats(stats),
        onMined: (event) => {
          useGame.getState().applyMine(event);
        },
        onBlocked: (reason) => {
          useGame.getState().pushToast({ kind: "info", title: reason });
        },
        onPlace: (request) => {
          void placeBuilding(request.kind, request.originX, request.y, request.originZ, request.rotation);
        },
      })
      .catch((error) => {
        if (disposed) return;
        useGame.getState().pushToast({
          kind: "error",
          title: "The claim failed to load",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    async function placeBuilding(
      kind: BuildingKind,
      x: number,
      y: number,
      z: number,
      rotation: 0 | 1 | 2 | 3
    ) {
      if (!adapter) return;
      const store = useGame.getState();

      const receipt = await store.run(
        "place",
        () => adapter.placeBuilding(kind, x, y, z, rotation),
        () => ({ kind: "success" as const, title: `${kind} placed` })
      );

      if (receipt) {
        await store.refresh(adapter);
        // Leaving build mode after a successful placement matches how every
        // other builder works, and stops accidental double-spends.
        store.setBuildKind(null);
        engine.setMode("mine");
      }
    }

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("resize", resize);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", resize);
      engine.dispose();
      canvas.remove();
      engineRef.current = null;
    };
  }, [claimSeed, adapter]);

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-void"
      onPointerDown={(event) => {
        // Left button only; right and middle belong to the camera.
        if (event.button === 0 && !event.shiftKey) engineRef.current?.onPrimaryDown();
      }}
      onPointerUp={() => engineRef.current?.onPrimaryUp()}
      onPointerLeave={() => engineRef.current?.onPrimaryUp()}
    >
      {/* Owned by the effect, never by React — keeping it in its own empty
          container means React has no children here to reconcile against. */}
      <div ref={containerRef} className="absolute inset-0" />

      {!ready && <LoadingVeil progress={progress.value} label={progress.label} />}
    </div>
  );
}

/* ==========================================================================
   Loading
   ========================================================================== */

function LoadingVeil({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-void">
      <div className="vx-grid pointer-events-none absolute inset-0 opacity-[0.12]" />

      <div className="relative w-full max-w-sm px-8">
        {/* A shaft sinking through the strata — the loading bar is the game's
            own subject, which beats a spinner. */}
        <div className="mx-auto mb-8 flex h-28 w-14 flex-col overflow-hidden border border-edge">
          {[
            { color: "#6b5133", height: 12 },
            { color: "#5f6673", height: 34 },
            { color: "#343b4a", height: 28 },
            { color: "#262231", height: 20 },
            { color: "#15171e", height: 6 },
          ].map((band, i) => (
            <div key={i} style={{ background: band.color, height: `${band.height}%` }} />
          ))}
          <div
            className="absolute left-1/2 top-0 w-3 -translate-x-1/2 bg-amber transition-[height] duration-300 ease-out"
            style={{ height: `${Math.min(100, progress * 100)}%`, boxShadow: "0 0 16px 2px var(--color-amber)" }}
          />
        </div>

        <div className="flex items-baseline justify-between">
          <span className="font-display text-[11px] uppercase tracking-[0.16em] text-amber">
            {label}
          </span>
          <span className="tnum text-[11px] text-mute">{Math.round(progress * 100)}%</span>
        </div>

        <div className="mt-2 h-1 w-full bg-raised">
          <div
            className="h-full bg-amber transition-[width] duration-300 ease-out"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-mute">
          Generating 614,400 voxels from your claim seed. This happens once per
          session and never leaves your browser.
        </p>
      </div>
    </div>
  );
}
