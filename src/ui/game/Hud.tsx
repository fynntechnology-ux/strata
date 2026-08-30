"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Engine, EngineStats, HoverInfo } from "@/game/engine";
import { blockHex } from "@/game/blocks";
import { compact, duration, num } from "@/lib/format";
import { useChain } from "@/onchain/ChainProvider";
import { formatToken } from "@/onchain/types";
import { BUILDING_DEFS } from "@/sim/buildings";
import { RESOURCE_DEFS, bagEntries, bagTotal } from "@/sim/resources";
import {
  selectBuildings,
  selectPending,
  selectResources,
  useGame,
  type PanelId,
} from "@/sim/store";
import { Button, Meter, cn } from "@/ui/primitives";
import {
  BUILDING_ICONS,
  IconChart,
  IconCrate,
  IconCube,
  IconEnergy,
  IconMarket,
  IconPick,
  IconStack,
  IconTag,
} from "@/ui/icons";
import { Logo } from "@/ui/site/SiteChrome";
import { WalletButton } from "./WalletButton";

/**
 * The in-game HUD.
 *
 * Laid out as an overlay grid over the canvas with `pointer-events: none` on
 * the container and `auto` on the controls, so the world stays clickable
 * everywhere the HUD isn't actually occupying pixels.
 *
 * Anything that changes at frame rate — energy, mining progress, FPS — is
 * written straight to the DOM from a `requestAnimationFrame` loop rather than
 * being held in React state. Re-rendering a tree sixty times a second to move
 * one progress bar is the fastest way to make a smooth game feel slow.
 */

export function Hud({
  engine,
  hover,
  stats,
}: {
  engine: Engine | null;
  hover: HoverInfo | null;
  stats: EngineStats | null;
}) {
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const buildKind = useGame((s) => s.buildKind);
  const setBuildKind = useGame((s) => s.setBuildKind);
  const level = useGame((s) => s.level);
  const snapshot = useGame((s) => s.snapshot);
  const resources = useGame(selectResources);
  const pending = useGame(selectPending);
  const buildings = useGame(selectBuildings);
  const city = useGame((s) => s.city);
  const pendingMined = useGame((s) => s.pendingMined);

  const { simulated } = useChain();

  // Panels swallow keyboard input, so the camera has to be told to stand down.
  useEffect(() => {
    engine?.setInputBlocked(panel !== null);
  }, [engine, panel]);

  useEffect(() => {
    if (!engine) return;
    engine.setMode(buildKind ? "build" : "mine", buildKind);
  }, [engine, buildKind]);

  // R rotates the building ghost — a builder convention worth keeping.
  useEffect(() => {
    if (!buildKind) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "KeyT") engine?.rotateBuild();
      if (event.code === "Escape") setBuildKind(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [buildKind, engine, setBuildKind]);

  const balance = snapshot?.balance ?? 0n;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between">
      {/* ---- top bar --------------------------------------------------- */}
      <div className="pointer-events-auto flex items-center gap-3 border-b border-edge bg-deep/88 px-3 py-2 backdrop-blur-md">
        <Link href="/" className="hidden shrink-0 sm:block">
          <Logo size={22} withText={false} />
        </Link>

        {simulated && (
          <span className="hidden shrink-0 items-center gap-1.5 border border-cyan/35 bg-cyan/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan md:inline-flex">
            <span className="h-1 w-1 bg-cyan" />
            Simulated
          </span>
        )}

        <ResourceRail resources={resources} capacity={city.storageCap} />

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <div className="hidden text-right sm:block">
            <div className="text-[9px] uppercase tracking-[0.14em] text-mute">Balance</div>
            <div className="tnum text-sm font-semibold leading-tight text-amber">
              {formatToken(balance)}
            </div>
          </div>
          <LevelBadge level={level.level} into={level.into} needed={level.needed} />
          <WalletButton />
        </div>
      </div>

      {/* ---- left column ----------------------------------------------- */}
      <div className="pointer-events-none flex flex-1 items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto flex w-56 flex-col gap-3">
          {bagTotal(pending) > 0 && <PendingYield pending={pending} />}
          {bagTotal(pendingMined) > 0 && (
            <div className="vx-panel px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.13em] text-mute">
                Uncommitted haul
              </div>
              <div className="tnum mt-0.5 text-sm text-hi">
                {num(bagTotal(pendingMined))} units
              </div>
              <div className="mt-1 text-[10px] leading-snug text-faint">
                Batched — commits automatically
              </div>
            </div>
          )}
        </div>

        <div className="pointer-events-auto w-60">
          {hover && <BlockInspector hover={hover} />}
          {buildKind && <BuildGhostCard kind={buildKind} onCancel={() => setBuildKind(null)} />}
        </div>
      </div>

      {/* ---- bottom bar ------------------------------------------------ */}
      <div className="pointer-events-auto border-t border-edge bg-deep/88 px-3 py-2 backdrop-blur-md">
        <div className="flex items-end gap-3">
          <EnergyMeter engine={engine} />

          <PanelDock panel={panel} setPanel={setPanel} buildingCount={buildings.length} />

          <div className="ml-auto hidden items-center gap-4 text-right lg:flex">
            <CityPulse
              power={city.powerProduced - city.powerConsumed}
              workers={`${city.workersUsed}/${city.workersAvailable}`}
              efficiency={city.powerEfficiency}
            />
            {stats && <DebugReadout stats={stats} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Resources
   ========================================================================== */

function ResourceRail({
  resources,
  capacity,
}: {
  resources: Record<string, number | undefined>;
  capacity: number;
}) {
  const entries = bagEntries(resources).slice(0, 7);
  const total = bagTotal(resources);
  const nearFull = total / capacity > 0.85;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {entries.length === 0 && (
        <span className="text-[11px] text-faint">Nothing mined yet — click the ground</span>
      )}

      {entries.map(([kind, qty]) => {
        const def = RESOURCE_DEFS[kind];
        return (
          <div
            key={kind}
            title={`${def.label} — worth ${def.baseValue} each`}
            className="flex shrink-0 items-center gap-1.5 border border-edge bg-crust px-2 py-1"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 border border-white/10"
              style={{ background: def.color }}
            />
            <span className="tnum text-[11px] text-hi">{compact(qty)}</span>
          </div>
        );
      })}

      <div
        className={cn(
          "ml-1 hidden shrink-0 border px-2 py-1 text-[10px] xl:block",
          nearFull ? "border-warn/50 bg-warn/10 text-warn" : "border-edge bg-crust text-mute"
        )}
        title="Storage used. Production stops when full — build a Silo."
      >
        <span className="tnum">
          {compact(total)}/{compact(capacity)}
        </span>
      </div>
    </div>
  );
}

function PendingYield({ pending }: { pending: Record<string, number | undefined> }) {
  const { adapter } = useChain();
  const busy = useGame((s) => s.busy.has("claim"));
  const run = useGame((s) => s.run);
  const refresh = useGame((s) => s.refresh);

  return (
    <div className="vx-panel vx-ticks p-3">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.13em] text-cyan">
        <span className="h-1 w-1 bg-cyan" style={{ animation: "vx-pulse 1.8s infinite" }} />
        City output waiting
      </div>

      <ul className="mt-2 space-y-1">
        {bagEntries(pending)
          .slice(0, 4)
          .map(([kind, qty]) => (
            <li key={kind} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0"
                  style={{ background: RESOURCE_DEFS[kind].color }}
                />
                <span className="truncate text-[11px] text-body">
                  {RESOURCE_DEFS[kind].label}
                </span>
              </span>
              <span className="tnum shrink-0 text-[11px] text-hi">+{compact(qty)}</span>
            </li>
          ))}
      </ul>

      <Button
        size="sm"
        variant="primary"
        full
        className="mt-2.5"
        loading={busy}
        onClick={async () => {
          if (!adapter) return;
          const ok = await run("claim", () => adapter.claimYield(), () => ({
            kind: "success" as const,
            title: "City output settled",
          }));
          if (ok) await refresh(adapter);
        }}
      >
        Collect
      </Button>
    </div>
  );
}

/* ==========================================================================
   Energy — updated outside React
   ========================================================================== */

function EnergyMeter({ engine }: { engine: Engine | null }) {
  const stats = useGame((s) => s.stats);
  const fillRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!engine) return;
    let frame = 0;

    const update = () => {
      frame = requestAnimationFrame(update);
      const energy = engine.energy;
      const ratio = Math.max(0, Math.min(1, energy / stats.energyMax));

      if (fillRef.current) fillRef.current.style.width = `${ratio * 100}%`;
      if (valueRef.current) {
        valueRef.current.textContent = `${Math.floor(energy)}/${Math.round(stats.energyMax)}`;
      }
      if (hintRef.current) {
        const remaining = (stats.energyMax - energy) / stats.energyRegen;
        hintRef.current.textContent = remaining > 1 ? `full in ${duration(remaining)}` : "full";
      }
    };

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [engine, stats.energyMax, stats.energyRegen]);

  return (
    <div className="w-40 shrink-0 sm:w-52">
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-mute">
          <IconEnergy size={11} className="text-warn" />
          Energy
        </span>
        <span ref={valueRef} className="tnum text-[11px] text-hi">
          0/0
        </span>
      </div>

      <div className="mt-1 h-2 w-full bg-raised">
        <div
          ref={fillRef}
          className="h-full bg-gradient-to-r from-warn to-amber"
          style={{ width: "0%" }}
        />
      </div>

      <span ref={hintRef} className="mt-0.5 block text-[10px] text-faint">
        &nbsp;
      </span>
    </div>
  );
}

/* ==========================================================================
   Inspector
   ========================================================================== */

function BlockInspector({ hover }: { hover: HoverInfo }) {
  const unbreakable = !Number.isFinite(hover.breakMs);

  return (
    <div className="vx-panel p-3">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 h-7 w-7 shrink-0 border border-white/10"
          style={{ background: blockHex(hover.blockId) }}
        />
        <div className="min-w-0">
          <div className="truncate font-display text-[13px] text-hi">{hover.blockName}</div>
          <div className="truncate text-[10px] text-mute">{hover.depth}</div>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 text-[11px]">
        <Row label="Yields" value={hover.drop ? RESOURCE_DEFS[hover.drop].label : "Nothing"} />
        <Row
          label="Break time"
          value={unbreakable ? "—" : `${(hover.breakMs / 1000).toFixed(2)}s`}
        />
        <Row
          label="Energy"
          value={unbreakable ? "—" : hover.energyCost.toFixed(1)}
        />
      </dl>

      {unbreakable ? (
        <p className="mt-2.5 border border-bad/40 bg-bad/10 px-2 py-1 text-[10px] text-bad">
          Bedrock. Nothing breaks this.
        </p>
      ) : (
        <Meter
          value={hover.progress}
          max={1}
          segments={16}
          className="mt-2.5"
          color="var(--color-amber)"
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-mute">{label}</dt>
      <dd className="tnum truncate text-body">{value}</dd>
    </div>
  );
}

function BuildGhostCard({
  kind,
  onCancel,
}: {
  kind: keyof typeof BUILDING_DEFS;
  onCancel: () => void;
}) {
  const def = BUILDING_DEFS[kind];
  const Icon = BUILDING_ICONS[kind];

  return (
    <div className="vx-panel mt-3 p-3">
      <div className="flex items-center gap-2">
        <Icon size={16} style={{ color: def.accent }} />
        <span className="font-display text-[12px] uppercase tracking-[0.1em] text-hi">
          Placing {def.name}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-mute">
        Click flat ground inside your claim. <span className="text-body">T</span> rotates,{" "}
        <span className="text-body">Esc</span> cancels.
      </p>
      <Button size="sm" variant="ghost" full className="mt-2" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/* ==========================================================================
   Bottom bar pieces
   ========================================================================== */

const DOCK: Array<{ id: Exclude<PanelId, null>; label: string; icon: typeof IconCube }> = [
  { id: "inventory", label: "Gear", icon: IconCube },
  { id: "city", label: "City", icon: IconStack },
  { id: "sell", label: "Sell", icon: IconTag },
  { id: "packs", label: "Crates", icon: IconCrate },
  { id: "market", label: "Market", icon: IconMarket },
  { id: "leaderboard", label: "Ranks", icon: IconChart },
];

function PanelDock({
  panel,
  setPanel,
  buildingCount,
}: {
  panel: PanelId;
  setPanel: (id: PanelId) => void;
  buildingCount: number;
}) {
  return (
    <div className="flex flex-1 items-center justify-center gap-1.5">
      {DOCK.map((entry) => {
        const active = panel === entry.id;
        return (
          <button
            key={entry.id}
            onClick={() => setPanel(active ? null : entry.id)}
            className={cn(
              "vx-bevel group relative flex h-11 min-w-11 flex-col items-center justify-center gap-0.5 border px-2.5 transition-colors sm:min-w-16",
              active
                ? "border-amber/60 bg-amber/12 text-amber"
                : "border-edge bg-crust text-mute hover:border-edge-hi hover:text-hi"
            )}
          >
            <entry.icon size={15} />
            <span className="hidden text-[9px] uppercase tracking-[0.1em] sm:block">
              {entry.label}
            </span>
            {entry.id === "city" && buildingCount > 0 && (
              <span className="tnum absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center border border-edge-hi bg-panel px-1 text-[9px] text-body">
                {buildingCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function CityPulse({
  power,
  workers,
  efficiency,
}: {
  power: number;
  workers: string;
  efficiency: number;
}) {
  const short = power < 0;
  return (
    <div className="flex items-center gap-4">
      <div>
        <div className="text-[9px] uppercase tracking-[0.13em] text-mute">Power</div>
        <div
          className={cn("tnum text-[13px] font-semibold", short ? "text-bad" : "text-good")}
        >
          {power >= 0 ? "+" : ""}
          {power.toFixed(1)}
          {short && efficiency < 1 && (
            <span className="ml-1 text-[10px] font-normal text-warn">
              {Math.round(efficiency * 100)}%
            </span>
          )}
        </div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-[0.13em] text-mute">Crew</div>
        <div className="tnum text-[13px] font-semibold text-hi">{workers}</div>
      </div>
    </div>
  );
}

function DebugReadout({ stats }: { stats: EngineStats }) {
  const [open, setOpen] = useState(false);

  return (
    <button
      onClick={() => setOpen((v) => !v)}
      className="tnum border border-edge bg-crust px-2 py-1 text-left text-[10px] text-mute transition-colors hover:text-body"
      title="Renderer statistics"
    >
      <span className={cn(stats.fps >= 50 ? "text-good" : stats.fps >= 30 ? "text-warn" : "text-bad")}>
        {stats.fps} fps
      </span>
      {open && (
        <span className="ml-2 text-faint">
          {num(stats.triangles)} tris · {stats.chunks} chunks · {stats.pixelRatio}x
          {stats.pendingChunks > 0 && ` · ${stats.pendingChunks} queued`}
        </span>
      )}
    </button>
  );
}

function LevelBadge({
  level,
  into,
  needed,
}: {
  level: number;
  into: number;
  needed: number;
}) {
  return (
    <div
      className="hidden w-24 sm:block"
      title={`${num(into)} / ${num(needed)} XP to level ${level + 1}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-[0.14em] text-mute">Level</span>
        <span className="tnum text-sm font-semibold leading-none text-hi">{level}</span>
      </div>
      <Meter
        value={into}
        max={needed}
        segments={8}
        color="var(--color-cyan)"
        className="mt-1 h-1.5"
      />
    </div>
  );
}

export { IconPick };
