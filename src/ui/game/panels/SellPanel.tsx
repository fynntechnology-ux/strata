"use client";

import { useMemo, useState } from "react";
import { useChain } from "@/onchain/ChainProvider";
import { formatToken, toRaw } from "@/onchain/types";
import { RECIPES, RESOURCE_DEFS, bagEntries } from "@/sim/resources";
import { saleProceeds } from "@/sim/economy";
import { selectResources, useGame } from "@/sim/store";
import type { ResourceBag, ResourceKind } from "@/sim/types";
import { compact, num } from "@/lib/format";
import { Button, EmptyState, cn } from "@/ui/primitives";
import { IconIngot, IconTag } from "@/ui/icons";

/**
 * Selling and refining.
 *
 * The panel leads with what a stack is worth *refined* rather than raw,
 * because that difference is the single most important thing in the economy
 * and new players otherwise sell their ore at a quarter of its value and never
 * find out why they're poor.
 */
export function SellPanel() {
  const resources = useGame(selectResources);
  const city = useGame((s) => s.city);
  const busy = useGame((s) => s.busy);
  const run = useGame((s) => s.run);
  const refresh = useGame((s) => s.refresh);
  const { adapter } = useChain();

  const [selected, setSelected] = useState<ResourceBag>({});

  const entries = bagEntries(resources);
  const selectedValue = useMemo(() => saleProceeds(selected), [selected]);
  const totalValue = useMemo(() => saleProceeds(resources), [resources]);

  /** Raw stacks that a smelter could turn into something worth far more. */
  const refinable = useMemo(
    () =>
      RECIPES.filter((recipe) => {
        const have = resources[recipe.input] ?? 0;
        const coal = resources.coal ?? 0;
        return have >= recipe.inputQty && coal >= recipe.coal;
      }),
    [resources]
  );

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<IconTag size={30} />}
        title="Nothing to sell"
        message="Break some ore blocks, or let an Extractor run for a while."
      />
    );
  }

  const toggleAll = () => {
    if (Object.keys(selected).length > 0) setSelected({});
    else setSelected({ ...resources });
  };

  return (
    <>
      {refinable.length > 0 && city.smelterCount > 0 && (
        <RefinePrompt refinable={refinable} resources={resources} />
      )}

      <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
        <span className="text-[11px] text-mute">
          Everything is worth <span className="tnum text-body">{num(totalValue)}</span> STRATA
        </span>
        <button
          onClick={toggleAll}
          className="text-[11px] text-amber transition-colors hover:text-amber-hi"
        >
          {Object.keys(selected).length > 0 ? "Clear" : "Select all"}
        </button>
      </div>

      <ul className="divide-y divide-edge/60">
        {entries.map(([kind, qty]) => {
          const def = RESOURCE_DEFS[kind];
          const picked = selected[kind] ?? 0;

          return (
            <li key={kind} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span
                  className="h-6 w-6 shrink-0 border border-white/10"
                  style={{ background: def.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] text-hi">{def.label}</span>
                    <span className="tnum shrink-0 text-[11px] text-mute">
                      {num(def.baseValue)} ea
                    </span>
                  </div>
                  <div className="tnum text-[11px] text-mute">
                    {num(qty)} held
                    {!def.refined && (
                      <span className="ml-1.5 text-faint">· refine for ~4×</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={qty}
                  value={picked}
                  onChange={(event) =>
                    setSelected((prev) => {
                      const next = { ...prev };
                      const value = Number(event.target.value);
                      if (value <= 0) delete next[kind];
                      else next[kind] = value;
                      return next;
                    })
                  }
                  className="h-1 flex-1 cursor-pointer appearance-none bg-raised accent-amber"
                  aria-label={`Amount of ${def.label} to sell`}
                />
                <span className="tnum w-16 shrink-0 text-right text-[11px] text-body">
                  {compact(picked)}
                </span>
                <button
                  onClick={() => setSelected((prev) => ({ ...prev, [kind]: qty }))}
                  className="shrink-0 border border-edge px-1.5 py-0.5 text-[10px] text-mute transition-colors hover:text-hi"
                >
                  Max
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 border-t border-edge bg-deep/97 p-4 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-[0.13em] text-mute">Proceeds</span>
          <span className="tnum text-xl font-semibold text-amber">
            {formatToken(toRaw(selectedValue))}
          </span>
        </div>
        <Button
          variant="primary"
          full
          className="mt-3"
          disabled={selectedValue <= 0}
          loading={busy.has("sell")}
          onClick={async () => {
            if (!adapter) return;
            const ok = await run("sell", () => adapter.sellResources(selected), (receipt) => ({
              kind: "success" as const,
              title: `Sold for ${formatToken(receipt.data.proceeds)} STRATA`,
              signature: receipt.signature,
            }));
            if (ok) {
              setSelected({});
              await refresh(adapter);
            }
          }}
        >
          Sell selected
        </Button>
      </div>
    </>
  );
}

/* ==========================================================================
   Refine
   ========================================================================== */

function RefinePrompt({
  refinable,
  resources,
}: {
  refinable: typeof RECIPES;
  resources: ResourceBag;
}) {
  const busy = useGame((s) => s.busy);
  const run = useGame((s) => s.run);
  const refresh = useGame((s) => s.refresh);
  const { adapter } = useChain();
  const [chosen, setChosen] = useState<ResourceKind | null>(null);

  const recipe = refinable.find((r) => r.input === chosen) ?? refinable[0];
  const have = resources[recipe.input] ?? 0;
  const coal = resources.coal ?? 0;
  const batches = Math.min(
    Math.floor(have / recipe.inputQty),
    Math.floor(coal / recipe.coal)
  );
  const outputValue = RESOURCE_DEFS[recipe.output].baseValue * batches * recipe.outputQty;
  const inputValue = RESOURCE_DEFS[recipe.input].baseValue * batches * recipe.inputQty;
  const fee = Math.ceil(outputValue * 0.08);

  return (
    <div className="border-b border-edge bg-crust p-4">
      <div className="flex items-center gap-2">
        <IconIngot size={15} className="text-ember" />
        <h3 className="font-display text-[12px] uppercase tracking-[0.11em] text-hi">
          Rush a smelt
        </h3>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {refinable.map((option) => (
          <button
            key={option.output}
            onClick={() => setChosen(option.input)}
            className={cn(
              "border px-2 py-1 text-[11px] transition-colors",
              option.input === recipe.input
                ? "border-amber/60 bg-amber/12 text-amber"
                : "border-edge bg-deep text-mute hover:text-hi"
            )}
          >
            {RESOURCE_DEFS[option.output].label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-mute">
        {batches > 0 ? (
          <>
            Convert <span className="tnum text-body">{num(batches * recipe.inputQty)}</span>{" "}
            {RESOURCE_DEFS[recipe.input].label} plus{" "}
            <span className="tnum text-body">{num(batches * recipe.coal)}</span> coal into{" "}
            <span className="tnum text-body">{num(batches * recipe.outputQty)}</span>{" "}
            {RESOURCE_DEFS[recipe.output].label} —{" "}
            <span className="text-good">{num(outputValue - inputValue)} more value</span>, minus a{" "}
            {num(fee)} rush fee.
          </>
        ) : (
          <>Not enough input or coal for a batch right now.</>
        )}
      </p>

      <Button
        size="sm"
        variant="secondary"
        full
        className="mt-2.5"
        disabled={batches <= 0}
        loading={busy.has("refine")}
        onClick={async () => {
          if (!adapter) return;
          const ok = await run(
            "refine",
            () => adapter.refine({ [recipe.input]: batches * recipe.inputQty }),
            () => ({ kind: "success" as const, title: "Batch refined" })
          );
          if (ok) await refresh(adapter);
        }}
      >
        Refine now
      </Button>

      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        Smelters do this for free over time. The fee is for skipping the wait.
      </p>
    </div>
  );
}
