"use client";

import { useEffect, useState } from "react";
import { useChain } from "@/onchain/ChainProvider";
import { formatToken } from "@/onchain/types";
import type { LeaderboardRow } from "@/onchain/adapter";
import { shortenAddress } from "@/onchain/wallet/standard";
import { compact } from "@/lib/format";
import { Spinner, cn } from "@/ui/primitives";
import { IconChart } from "@/ui/icons";

/**
 * Leaderboard.
 *
 * Every simulated participant is labelled as such. A fabricated leaderboard
 * presented as real would be the single most dishonest thing this build could
 * do, so the marker is not subtle and the footnote is not buried.
 */
export function LeaderboardPanel() {
  const { adapter } = useChain();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!adapter) return;

    adapter
      .getLeaderboard(25)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [adapter]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-mute">
        <Spinner size={20} />
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-edge/60">
        {rows.map((row) => (
          <li
            key={row.address}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5",
              !row.synthetic && "bg-amber/8"
            )}
          >
            <span
              className={cn(
                "tnum w-7 shrink-0 text-right text-[13px] font-semibold",
                row.rank === 1
                  ? "text-r-legendary"
                  : row.rank <= 3
                    ? "text-body"
                    : "text-mute"
              )}
            >
              {row.rank}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "truncate text-[13px]",
                    row.synthetic ? "text-body" : "font-semibold text-amber"
                  )}
                >
                  {row.displayName}
                </span>
                {row.synthetic && (
                  <span
                    className="shrink-0 border border-edge px-1 text-[8px] uppercase tracking-[0.1em] text-faint"
                    title="A simulated participant, not a real player"
                  >
                    sim
                  </span>
                )}
              </div>
              <div className="tnum truncate text-[10px] text-faint">
                {shortenAddress(row.address)} · lv {row.level} · {compact(row.totalMined)} mined
              </div>
            </div>

            <span className="tnum shrink-0 text-[12px] text-hi">
              {formatToken(row.netWorth)}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-start gap-2.5 border-t border-edge p-4">
        <IconChart size={14} className="mt-0.5 shrink-0 text-faint" />
        <p className="text-[11px] leading-relaxed text-faint">
          Every row marked <span className="text-mute">sim</span> is generated locally to give the
          ladder a shape — they are not other players, and no real leaderboard exists yet. Your own
          row is computed from your balance plus the salvage value of everything you own.
        </p>
      </div>
    </>
  );
}
