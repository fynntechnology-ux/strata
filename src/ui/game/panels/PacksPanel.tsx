"use client";

import { useCallback, useEffect, useState } from "react";
import { useChain } from "@/onchain/ChainProvider";
import { formatToken, toRaw, type PackCommit } from "@/onchain/types";
import { PACK_LIST, applyLuck, tableAsPercentages } from "@/sim/packs";
import { RARITY_META, type PackKind } from "@/sim/types";
import { useGame } from "@/sim/store";
import { num, relativeTime } from "@/lib/format";
import { Button, Card, cn } from "@/ui/primitives";
import { IconCrate, IconLock } from "@/ui/icons";

/**
 * Crate purchase and reveal.
 *
 * The two-step flow is exposed rather than hidden behind one button, because
 * it is the entire fairness argument. A player who can see "your secret is
 * locked in, now let's mix in entropy that didn't exist yet" understands why
 * the result couldn't have been chosen for them.
 */
export function PacksPanel() {
  const balance = useGame((s) => s.snapshot?.balance ?? 0n);
  const stats = useGame((s) => s.stats);
  const busy = useGame((s) => s.busy);
  const run = useGame((s) => s.run);
  const refresh = useGame((s) => s.refresh);
  const setRevealing = useGame((s) => s.setRevealing);
  const address = useGame((s) => s.address);
  const { adapter } = useChain();

  const [pending, setPending] = useState<PackCommit[]>([]);
  const [expanded, setExpanded] = useState<PackKind | null>(null);

  /** Imperative refresh, called after a reveal or a purchase. */
  const loadPending = useCallback(async () => {
    if (!adapter || !address) return;
    const commits = await adapter.getPendingCommits(address);
    setPending(commits);
  }, [adapter, address]);

  // Initial load, with cancellation so a slow response can't land after the
  // panel closes or the wallet changes underneath it.
  useEffect(() => {
    if (!adapter || !address) return;
    let cancelled = false;

    adapter
      .getPendingCommits(address)
      .then((commits) => {
        if (!cancelled) setPending(commits);
      })
      .catch(() => {
        /* a failed read just leaves the list empty; the user can reopen */
      });

    return () => {
      cancelled = true;
    };
  }, [adapter, address]);

  return (
    <>
      {pending.length > 0 && (
        <div className="border-b border-edge bg-amber/8 p-4">
          <div className="flex items-center gap-2">
            <IconLock size={14} className="text-amber" />
            <h3 className="font-display text-[12px] uppercase tracking-[0.11em] text-amber">
              {pending.length} crate{pending.length > 1 ? "s" : ""} sealed
            </h3>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-body">
            Your secret is committed. Reveal it to mix in the slot hash and mint the contents.
          </p>

          <div className="mt-3 space-y-2">
            {pending.map((commit) => (
              <div
                key={commit.id}
                className="flex items-center gap-3 border border-edge bg-deep p-2.5"
              >
                <IconCrate size={18} className="shrink-0 text-amber" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-hi">
                    {PACK_LIST.find((p) => p.kind === commit.kind)?.name}
                  </div>
                  <div className="tnum truncate text-[10px] text-faint">
                    slot {num(commit.committedSlot)} · {relativeTime(commit.committedAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy.has(`reveal-${commit.id}`)}
                  onClick={async () => {
                    if (!adapter) return;
                    const receipt = await run(`reveal-${commit.id}`, () =>
                      adapter.revealPack(commit.id)
                    );
                    if (receipt) {
                      setRevealing(receipt.data);
                      await Promise.all([refresh(adapter), loadPending()]);
                    }
                  }}
                >
                  Open
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 p-3">
        {PACK_LIST.map((pack) => {
          const price = toRaw(pack.priceTokens);
          const affordable = balance >= price;
          const open = expanded === pack.kind;

          return (
            <Card key={pack.kind} className="relative overflow-hidden">
              <span
                className="absolute inset-x-0 top-0 h-[3px]"
                style={{ background: pack.accent }}
              />

              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-[15px] text-hi">{pack.name}</h3>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.13em] text-mute">
                      {pack.tagline}
                    </p>
                  </div>
                  <IconCrate size={26} style={{ color: pack.accent }} className="shrink-0" />
                </div>

                <p className="mt-3 text-[12px] leading-relaxed text-mute">{pack.description}</p>

                <div className="mt-3 flex items-center gap-3 text-[11px]">
                  <span className="tnum text-body">{pack.draws} draws</span>
                  <span className="text-faint">·</span>
                  <button
                    onClick={() => setExpanded(open ? null : pack.kind)}
                    className="text-amber transition-colors hover:text-amber-hi"
                  >
                    {open ? "Hide odds" : "See odds"}
                  </button>
                  {stats.luck > 0 && (
                    <span className="ml-auto text-cyan">+{stats.luck} luck applied</span>
                  )}
                </div>

                {open && <OddsTable kind={pack.kind} />}

                {pack.floorLabel && (
                  <div className="mt-3 border border-r-legendary/40 bg-r-legendary/10 px-2.5 py-1.5 text-[11px] text-r-legendary">
                    {pack.floorLabel}
                  </div>
                )}

                <Button
                  variant={affordable ? "primary" : "secondary"}
                  full
                  className="mt-4"
                  disabled={!affordable}
                  loading={busy.has(`commit-${pack.kind}`)}
                  onClick={async () => {
                    if (!adapter) return;
                    const ok = await run(
                      `commit-${pack.kind}`,
                      () => adapter.commitPack(pack.kind),
                      () => ({
                        kind: "info" as const,
                        title: "Crate sealed",
                        message: "Reveal it above to see what's inside",
                      })
                    );
                    if (ok) {
                      await Promise.all([refresh(adapter), loadPending()]);
                    }
                  }}
                >
                  {affordable
                    ? `Buy · ${formatToken(price)} STRATA`
                    : `Need ${formatToken(price - balance)} more`}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="px-4 pb-5 text-[11px] leading-relaxed text-faint">
        Buying seals a crate with a hash of a secret generated on your device. Revealing publishes
        the secret and combines it with a slot hash that did not exist when you committed — so
        neither you nor the game could have steered the result.
      </p>
    </>
  );
}

function OddsTable({ kind }: { kind: PackKind }) {
  const stats = useGame((s) => s.stats);
  const pack = PACK_LIST.find((p) => p.kind === kind)!;

  // Show the table the player will actually roll on, luck included — quoting
  // base odds while their Scanner is shifting them would be a lie of omission.
  const rows = tableAsPercentages(
    stats.luck > 0 ? applyLuck(pack.table, stats.luck) : pack.table
  );

  return (
    <div className="mt-3 space-y-1.5 border border-edge bg-deep p-3">
      {rows.map((row) => (
        <div key={row.rarity} className="flex items-center gap-2.5">
          <span
            className="w-20 shrink-0 text-[10px] uppercase tracking-[0.09em]"
            style={{ color: RARITY_META[row.rarity].color }}
          >
            {RARITY_META[row.rarity].label}
          </span>
          <div className="h-1.5 flex-1 bg-raised">
            <div
              className="h-full"
              style={{
                width: `${Math.sqrt(row.pct / 100) * 100}%`,
                background: RARITY_META[row.rarity].color,
              }}
            />
          </div>
          <span className="tnum w-14 shrink-0 text-right text-[10px] text-body">
            {row.pct < 1 ? row.pct.toFixed(2) : row.pct.toFixed(1)}%
          </span>
        </div>
      ))}
      <p className={cn("pt-1 text-[10px] text-faint")}>
        Per draw. Bars use a square-root scale so the rare end stays visible.
      </p>
    </div>
  );
}
