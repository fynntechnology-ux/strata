"use client";

import { useEffect, useMemo, useState } from "react";
import { formatToken, type PackReveal as PackRevealData } from "@/onchain/types";
import { ARCHETYPE_BY_KEY, formatStat, isStatBeneficial } from "@/sim/items";
import { RESOURCE_DEFS } from "@/sim/resources";
import { RARITY_META, type StatKey } from "@/sim/types";
import { bagEntries } from "@/sim/resources";
import { useGame } from "@/sim/store";
import { num } from "@/lib/format";
import { Button, RarityBadge, cn } from "@/ui/primitives";
import { SLOT_ICONS } from "@/ui/icons";

/**
 * Crate reveal.
 *
 * Cards land one at a time, roughly half a second apart. The delay is the
 * entire point — a crate that dumps five items instantly has no moment in it.
 * The backdrop warms toward the best rarity as they land, so a Legendary is
 * felt before it is read.
 *
 * The verification block at the bottom is not decoration. It carries the two
 * halves of the seed and the resulting hash, which is what makes the published
 * odds checkable rather than merely stated.
 */

const STAGGER_MS = 520;

/**
 * Split in two so the animation state resets by remounting rather than by
 * clearing it in an effect. Keying on the commit id means each reveal starts
 * from a genuinely fresh `landed` counter, with no synchronous state writes.
 */
export function PackReveal() {
  const reveal = useGame((s) => s.revealing);
  if (!reveal) return null;
  return <RevealOverlay key={reveal.commitId} reveal={reveal} />;
}

function RevealOverlay({ reveal }: { reveal: PackRevealData }) {
  const setRevealing = useGame((s) => s.setRevealing);
  const [landed, setLanded] = useState(0);
  const [showProof, setShowProof] = useState(false);

  const items = useMemo(() => reveal.reward.items, [reveal]);

  useEffect(() => {
    const timers = items.map((_, index) =>
      setTimeout(() => setLanded(index + 1), 260 + index * STAGGER_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, [items]);

  const best = items.reduce(
    (top, item) => (RARITY_META[item.rarity].tier > RARITY_META[top].tier ? item.rarity : top),
    items[0]?.rarity ?? "common"
  );
  const bestMeta = RARITY_META[best];
  const allLanded = landed >= items.length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-void/92 backdrop-blur-md" />

      {/* The glow only reaches full strength once the best card has landed. */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-1000"
        style={{
          opacity: allLanded ? 1 : 0.25,
          background: `radial-gradient(ellipse at 50% 45%, ${bestMeta.color}22, transparent 62%)`,
        }}
      />

      <div className="relative flex max-h-full w-full max-w-4xl flex-col overflow-y-auto">
        <div className="mb-6 text-center">
          <p className="font-display text-[11px] uppercase tracking-[0.22em] text-amber">
            Crate opened
          </p>
          <h2 className="mt-1.5 text-2xl sm:text-3xl">
            {allLanded ? headline(best) : "Cracking the seal…"}
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((item, index) => {
            const meta = RARITY_META[item.rarity];
            const archetype = ARCHETYPE_BY_KEY.get(item.archetype);
            const Icon = SLOT_ICONS[item.slot];
            const visible = index < landed;

            return (
              <div
                key={item.id}
                className={cn(
                  "vx-bevel relative overflow-hidden border bg-crust p-3 transition-all duration-500",
                  visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
                )}
                style={{
                  borderColor: visible ? `${meta.color}66` : "var(--color-edge)",
                  boxShadow: visible && meta.glow > 0.3 ? `0 0 30px -12px ${meta.color}` : undefined,
                  transitionDelay: `${index * 40}ms`,
                }}
              >
                <span
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: meta.color }}
                />

                {/* One-shot flare for anything genuinely worth reacting to. */}
                {visible && meta.tier >= 3 && (
                  <span
                    className="animate-flare pointer-events-none absolute inset-0"
                    style={{
                      background: `radial-gradient(circle at 50% 40%, ${meta.color}55, transparent 65%)`,
                    }}
                  />
                )}

                <div className="relative flex flex-col items-center pt-2 text-center">
                  <span
                    className="flex h-12 w-12 items-center justify-center border"
                    style={{
                      borderColor: `${meta.color}55`,
                      background: `${meta.color}14`,
                      color: meta.color,
                    }}
                  >
                    <Icon size={24} />
                  </span>

                  <h3 className="mt-2.5 line-clamp-2 min-h-[2.2rem] font-display text-[12px] leading-snug text-hi">
                    {archetype?.name}
                  </h3>

                  <div className="mt-1">
                    <RarityBadge rarity={item.rarity} size="sm" />
                  </div>

                  <ul className="mt-2.5 w-full space-y-0.5 border-t border-edge pt-2">
                    {(Object.entries(item.stats) as [StatKey, number][]).map(([key, value]) => (
                      <li
                        key={key}
                        className={cn(
                          "tnum truncate text-[10px]",
                          isStatBeneficial(key, value) ? "text-body" : "text-bad"
                        )}
                      >
                        {formatStat(key, value)}
                      </li>
                    ))}
                  </ul>

                  <div className="tnum mt-2 text-[10px] text-mute">{item.quality}% roll</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ---- extras ---------------------------------------------------- */}
        <div
          className={cn(
            "mt-5 transition-opacity duration-500",
            allLanded ? "opacity-100" : "opacity-0"
          )}
        >
          <div className="vx-panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
            {bagEntries(reveal.reward.resources).map(([kind, qty]) => (
              <span key={kind} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 border border-white/10"
                  style={{ background: RESOURCE_DEFS[kind].color }}
                />
                <span className="tnum text-[12px] text-body">
                  +{num(qty)} {RESOURCE_DEFS[kind].label}
                </span>
              </span>
            ))}

            {reveal.reward.tokens > 0n && (
              <span className="tnum ml-auto text-[13px] font-semibold text-amber">
                +{formatToken(reveal.reward.tokens)} STRATA
              </span>
            )}
          </div>

          {/* ---- proof ---------------------------------------------------- */}
          <div className="mt-3">
            <button
              onClick={() => setShowProof((v) => !v)}
              className="text-[11px] text-mute transition-colors hover:text-amber"
            >
              {showProof ? "Hide" : "Show"} the numbers behind this roll
            </button>

            {showProof && (
              <div className="vx-panel mt-2 space-y-2 p-4 text-[10px]">
                <ProofRow label="Your secret" value={reveal.clientSeed} />
                <ProofRow label="Slot hash" value={reveal.slotHash} />
                <ProofRow label="Combined seed" value={reveal.revealSeed} />
                <ProofRow label="Drop table" value={`version ${reveal.dropTableVersion}`} />
                <p className="border-t border-edge pt-2 leading-relaxed text-faint">
                  The combined seed is <span className="text-mute">sha256</span> of your secret,
                  the slot hash, your address and the crate nonce. Feed it to{" "}
                  <span className="text-mute">openPack()</span> in{" "}
                  <span className="text-mute">src/sim/packs.ts</span> and you get exactly these
                  items back. Your secret was committed as a hash before the slot hash existed, so
                  neither side could have picked the outcome.
                </p>
              </div>
            )}
          </div>

          <Button
            variant="primary"
            size="lg"
            full
            className="mt-4"
            onClick={() => setRevealing(null)}
          >
            Take it all
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProofRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-28 shrink-0 uppercase tracking-[0.1em] text-mute">{label}</span>
      <span className="tnum min-w-0 flex-1 break-all text-body">{value}</span>
    </div>
  );
}

function headline(best: keyof typeof RARITY_META): string {
  switch (best) {
    case "mythic":
      return "Mythic. That basically doesn't happen.";
    case "legendary":
      return "Legendary pull.";
    case "epic":
      return "Something worth keeping.";
    case "rare":
      return "A decent haul.";
    case "uncommon":
      return "Nothing broken in there.";
    default:
      return "Mostly scrap, but it's yours.";
  }
}
