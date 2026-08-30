"use client";

import { useEffect } from "react";
import { useGame, type PanelId } from "@/sim/store";
import { cn } from "@/ui/primitives";
import { IconClose } from "@/ui/icons";
import { InventoryPanel } from "./InventoryPanel";
import { CityPanel } from "./CityPanel";
import { SellPanel } from "./SellPanel";
import { PacksPanel } from "./PacksPanel";
import { MarketPanel } from "./MarketPanel";
import { LeaderboardPanel } from "./LeaderboardPanel";

/**
 * Panels are a right-hand drawer, not a modal.
 *
 * A modal would black out the world, and half the reason to open the City
 * panel is to look at the city while you decide. The drawer leaves the canvas
 * visible and interactive to its left, and the camera keeps orbiting.
 */

const PANEL_META: Record<
  Exclude<PanelId, null>,
  { title: string; subtitle: string; width: string }
> = {
  inventory: {
    title: "Equipment",
    subtitle: "One item per slot. Stats are additive.",
    width: "w-full sm:w-[420px]",
  },
  city: {
    title: "City",
    subtitle: "Workers gate what you can run. Power gates how well.",
    width: "w-full sm:w-[440px]",
  },
  sell: {
    title: "Sell & refine",
    subtitle: "Refining roughly quadruples value.",
    width: "w-full sm:w-[420px]",
  },
  packs: {
    title: "Supply crates",
    subtitle: "Published odds, verifiable rolls.",
    width: "w-full sm:w-[440px]",
  },
  market: {
    title: "Marketplace",
    subtitle: "Player listings. Salvage sets the floor.",
    width: "w-full sm:w-[560px] lg:w-[680px]",
  },
  leaderboard: {
    title: "Leaderboard",
    subtitle: "Ranked by net worth across the claim.",
    width: "w-full sm:w-[420px]",
  },
  stake: { title: "Staking", subtitle: "Lock currency for a yield boost.", width: "w-full sm:w-[400px]" },
  settings: { title: "Settings", subtitle: "", width: "w-full sm:w-[400px]" },
};

export function PanelHost() {
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);

  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPanel(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panel, setPanel]);

  if (!panel) return null;
  const meta = PANEL_META[panel];

  return (
    <aside
      className={cn(
        "pointer-events-auto absolute right-0 top-0 z-20 flex h-full flex-col",
        "animate-rise border-l border-edge bg-deep/97 backdrop-blur-xl",
        meta.width
      )}
      style={{ animationDuration: "0.24s" }}
      role="dialog"
      aria-label={meta.title}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm uppercase tracking-[0.12em] text-hi">
            {meta.title}
          </h2>
          {meta.subtitle && <p className="mt-0.5 text-[11px] text-mute">{meta.subtitle}</p>}
        </div>
        <button
          onClick={() => setPanel(null)}
          aria-label="Close panel"
          className="-mr-1 shrink-0 p-1.5 text-mute transition-colors hover:text-hi"
        >
          <IconClose size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {panel === "inventory" && <InventoryPanel />}
        {panel === "city" && <CityPanel />}
        {panel === "sell" && <SellPanel />}
        {panel === "packs" && <PacksPanel />}
        {panel === "market" && <MarketPanel />}
        {panel === "leaderboard" && <LeaderboardPanel />}
      </div>
    </aside>
  );
}
