"use client";

import { useState } from "react";
import { useChain } from "@/onchain/ChainProvider";
import { formatToken, toRaw } from "@/onchain/types";
import { BUILDING_DEFS, BUILDING_LIST, buildingCost, extractorRate } from "@/sim/buildings";
import { canAfford } from "@/sim/economy";
import { RESOURCE_DEFS, bagCovers } from "@/sim/resources";
import { SURFACE_Y, depthLabel } from "@/sim/strata";
import { selectBuildings, selectResources, useGame } from "@/sim/store";
import { dec, num } from "@/lib/format";
import { Button, EmptyState, Meter, Tabs, cn } from "@/ui/primitives";
import { BUILDING_ICONS, IconStack } from "@/ui/icons";

/**
 * City management.
 *
 * Split into "build" and "manage" because those are different jobs: one is
 * browsing a catalogue against a budget, the other is auditing what you
 * already own. Cramming both into one list makes both worse.
 */
export function CityPanel() {
  const [tab, setTab] = useState<"build" | "manage">("build");
  const buildings = useGame(selectBuildings);

  return (
    <>
      <CitySummary />
      <Tabs
        tabs={[
          { id: "build", label: "Build" },
          { id: "manage", label: "Manage", count: buildings.length },
        ]}
        value={tab}
        onChange={setTab}
        className="sticky top-0 z-10 bg-deep px-1"
      />
      {tab === "build" ? <BuildCatalogue /> : <BuildingList />}
    </>
  );
}

/* ==========================================================================
   Summary
   ========================================================================== */

function CitySummary() {
  const city = useGame((s) => s.city);
  const resources = useGame(selectResources);
  const used = Object.values(resources).reduce((n, v) => n + (v ?? 0), 0);
  const netPower = city.powerProduced - city.powerConsumed;

  return (
    <div className="grid grid-cols-3 gap-px border-b border-edge bg-edge">
      <div className="bg-crust p-3">
        <div className="text-[9px] uppercase tracking-[0.13em] text-mute">Crew</div>
        <div
          className={cn(
            "tnum mt-1 text-lg font-semibold leading-none",
            city.workersUsed >= city.workersAvailable ? "text-warn" : "text-hi"
          )}
        >
          {city.workersUsed}/{city.workersAvailable}
        </div>
        <Meter
          value={city.workersUsed}
          max={city.workersAvailable}
          segments={10}
          className="mt-2 h-1"
          color={city.workersUsed >= city.workersAvailable ? "var(--color-warn)" : "var(--color-good)"}
        />
      </div>

      <div className="bg-crust p-3">
        <div className="text-[9px] uppercase tracking-[0.13em] text-mute">Power</div>
        <div
          className={cn(
            "tnum mt-1 text-lg font-semibold leading-none",
            netPower < 0 ? "text-bad" : "text-good"
          )}
        >
          {netPower >= 0 ? "+" : ""}
          {dec(netPower)}
        </div>
        <div className="mt-2 text-[10px] text-faint">
          {city.powerEfficiency < 1
            ? `Running at ${Math.round(city.powerEfficiency * 100)}%`
            : "Grid stable"}
        </div>
      </div>

      <div className="bg-crust p-3">
        <div className="text-[9px] uppercase tracking-[0.13em] text-mute">Storage</div>
        <div className="tnum mt-1 text-lg font-semibold leading-none text-hi">
          {Math.round((used / city.storageCap) * 100)}%
        </div>
        <Meter
          value={used}
          max={city.storageCap}
          segments={10}
          className="mt-2 h-1"
          color={used / city.storageCap > 0.85 ? "var(--color-warn)" : "var(--color-cyan)"}
        />
      </div>
    </div>
  );
}

/* ==========================================================================
   Build
   ========================================================================== */

function BuildCatalogue() {
  const city = useGame((s) => s.city);
  const level = useGame((s) => s.level);
  const balance = useGame((s) => s.snapshot?.balance ?? 0n);
  const resources = useGame(selectResources);
  const buildKind = useGame((s) => s.buildKind);
  const setBuildKind = useGame((s) => s.setBuildKind);
  const setPanel = useGame((s) => s.setPanel);

  return (
    <div className="space-y-2 p-3">
      {BUILDING_LIST.map((def) => {
        const cost = buildingCost(def.kind, 1);
        const gate = canAfford(def.kind, city, level.level);
        const affordsTokens = balance >= toRaw(cost.tokens);
        const affordsResources = bagCovers(resources, cost.resources);
        const buildable = gate.ok && affordsTokens && affordsResources;
        const Icon = BUILDING_ICONS[def.kind];
        const active = buildKind === def.kind;

        return (
          <div
            key={def.kind}
            className={cn(
              "vx-bevel border p-3 transition-colors",
              active ? "border-amber/65 bg-panel" : "border-edge bg-crust"
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center border"
                style={{
                  borderColor: `${def.accent}40`,
                  background: `${def.accent}12`,
                  color: def.accent,
                }}
              >
                <Icon size={18} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate font-display text-[13px] text-hi">{def.name}</h3>
                  <span className="tnum shrink-0 text-[10px] text-mute">
                    {def.footprint[0]}×{def.footprint[1]}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-mute">{def.blurb}</p>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <CostChip
                label={formatToken(toRaw(cost.tokens))}
                ok={affordsTokens}
                color="var(--color-amber)"
              />
              {Object.entries(cost.resources).map(([kind, qty]) => (
                <CostChip
                  key={kind}
                  label={`${qty} ${RESOURCE_DEFS[kind as keyof typeof RESOURCE_DEFS].label}`}
                  ok={(resources[kind as keyof typeof resources] ?? 0) >= (qty ?? 0)}
                  color={RESOURCE_DEFS[kind as keyof typeof RESOURCE_DEFS].color}
                />
              ))}
              <span className="tnum ml-auto text-[10px] text-mute">
                {def.workers < 0 ? `+${-def.workers} crew` : `${def.workers} crew`} ·{" "}
                {def.powerL1 > 0 ? `+${def.powerL1}` : def.powerL1} pwr
              </span>
            </div>

            {!gate.ok ? (
              <p className="mt-2.5 border border-edge bg-deep px-2 py-1.5 text-[11px] text-warn">
                {gate.reason}
              </p>
            ) : (
              <Button
                size="sm"
                variant={active ? "outline" : "secondary"}
                full
                className="mt-2.5"
                disabled={!buildable}
                onClick={() => {
                  if (active) {
                    setBuildKind(null);
                  } else {
                    setBuildKind(def.kind);
                    // Close the drawer so the player can actually see where
                    // they're placing it.
                    setPanel(null);
                  }
                }}
              >
                {active ? "Cancel placement" : buildable ? "Place" : "Can't afford"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CostChip({ label, ok, color }: { label: string; ok: boolean; color: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 border px-1.5 text-[10px]",
        ok ? "border-edge bg-deep" : "border-bad/45 bg-bad/10 text-bad"
      )}
      style={ok ? { color } : undefined}
    >
      {ok && <span className="h-1.5 w-1.5" style={{ background: color }} />}
      {label}
    </span>
  );
}

/* ==========================================================================
   Manage
   ========================================================================== */

function BuildingList() {
  const buildings = useGame(selectBuildings);
  const balance = useGame((s) => s.snapshot?.balance ?? 0n);
  const resources = useGame(selectResources);
  const busy = useGame((s) => s.busy);
  const run = useGame((s) => s.run);
  const refresh = useGame((s) => s.refresh);
  const { adapter } = useChain();

  if (buildings.length === 0) {
    return (
      <EmptyState
        icon={<IconStack size={30} />}
        title="Nothing built yet"
        message="A Generator and a Habitat are the usual first two — everything else needs power and crew."
      />
    );
  }

  return (
    <div className="space-y-2 p-3">
      {buildings.map((building) => {
        const def = BUILDING_DEFS[building.kind];
        const Icon = BUILDING_ICONS[building.kind];
        const maxed = building.level >= def.maxLevel;
        const next = maxed ? null : buildingCost(building.kind, building.level + 1);
        const canUpgrade =
          next !== null &&
          balance >= toRaw(next.tokens) &&
          bagCovers(resources, next.resources);

        return (
          <div key={building.id} className="vx-bevel border border-edge bg-crust p-3">
            <div className="flex items-start gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center border"
                style={{
                  borderColor: `${def.accent}40`,
                  background: `${def.accent}12`,
                  color: def.accent,
                }}
              >
                <Icon size={18} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate font-display text-[13px] text-hi">{def.name}</h3>
                  <span className="tnum shrink-0 text-[11px] text-amber">
                    Lv {building.level}
                  </span>
                </div>
                <div className="tnum mt-0.5 text-[10px] text-mute">
                  {building.x}, {building.z}
                  {building.kind === "extractor" && building.boreDepth !== undefined && (
                    <>
                      {" · bore at "}
                      <span className="text-body">{depthLabel(Math.round(building.boreDepth))}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {building.kind === "extractor" && (
              <div className="mt-2.5">
                <div className="flex items-baseline justify-between text-[10px]">
                  <span className="text-mute">Depth reached</span>
                  <span className="tnum text-body">
                    {num(Math.max(0, SURFACE_Y - (building.boreDepth ?? SURFACE_Y)))}m
                  </span>
                </div>
                <Meter
                  value={SURFACE_Y - (building.boreDepth ?? SURFACE_Y)}
                  max={SURFACE_Y}
                  segments={20}
                  className="mt-1 h-1"
                  color="var(--color-ember)"
                />
                <p className="mt-1 text-[10px] text-faint">
                  Pulling {dec(extractorRate(building.level))}/s — richer the deeper it gets
                </p>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                full
                disabled={maxed || !canUpgrade}
                loading={busy.has(`up-${building.id}`)}
                onClick={async () => {
                  if (!adapter) return;
                  const ok = await run(
                    `up-${building.id}`,
                    () => adapter.upgradeBuilding(building.id),
                    () => ({ kind: "success" as const, title: `${def.name} upgraded` })
                  );
                  if (ok) await refresh(adapter);
                }}
              >
                {maxed
                  ? "Max level"
                  : next
                    ? `Upgrade · ${formatToken(toRaw(next.tokens))}`
                    : "Upgrade"}
              </Button>

              <Button
                size="sm"
                variant="danger"
                loading={busy.has(`rm-${building.id}`)}
                onClick={async () => {
                  if (!adapter) return;
                  const ok = await run(
                    `rm-${building.id}`,
                    () => adapter.removeBuilding(building.id),
                    () => ({
                      kind: "info" as const,
                      title: "Demolished",
                      message: "40% of the build cost was returned",
                    })
                  );
                  if (ok) await refresh(adapter);
                }}
              >
                Demolish
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
