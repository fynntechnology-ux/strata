"use client";

import type { ItemInstance } from "@/onchain/types";
import { ARCHETYPE_BY_KEY, formatStat, isStatBeneficial, itemPower } from "@/sim/items";
import { RARITY_META, type StatKey } from "@/sim/types";
import { RarityBadge, RarityEdge, cn } from "@/ui/primitives";
import { SLOT_ICONS } from "@/ui/icons";

/**
 * One equipment item.
 *
 * The quality bar matters more than it looks: rarity tells you the ceiling, but
 * quality tells you how close this particular roll got to it. A 12% Legendary
 * really is worse than a 96% Epic, and the card has to make that visible or
 * players will trade badly and feel cheated.
 */

export function ItemCard({
  item,
  onClick,
  selected = false,
  compactLayout = false,
  /** Suppresses the "Listed" badge where every card is listed by definition. */
  hideListedBadge = false,
  footer,
}: {
  item: ItemInstance;
  onClick?: () => void;
  selected?: boolean;
  compactLayout?: boolean;
  hideListedBadge?: boolean;
  footer?: React.ReactNode;
}) {
  const archetype = ARCHETYPE_BY_KEY.get(item.archetype);
  const meta = RARITY_META[item.rarity];
  const Icon = SLOT_ICONS[item.slot];
  const power = itemPower(item.stats, item.rarity);

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "vx-bevel relative border bg-crust transition-colors",
        onClick && "cursor-pointer hover:bg-panel",
        selected ? "border-amber/70 bg-panel" : "border-edge hover:border-edge-hi",
        compactLayout ? "p-2.5 pl-3.5" : "p-3 pl-4"
      )}
      style={
        meta.glow > 0.6
          ? { boxShadow: `inset 0 0 24px -14px ${meta.color}` }
          : undefined
      }
    >
      <RarityEdge rarity={item.rarity} />

      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border"
          style={{ borderColor: `${meta.color}40`, background: `${meta.color}12`, color: meta.color }}
        >
          <Icon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate font-display text-[13px] text-hi">
              {archetype?.name ?? item.archetype}
            </span>
            {item.equipped && (
              <span className="shrink-0 border border-good/45 bg-good/12 px-1.5 text-[9px] uppercase tracking-[0.1em] text-good">
                Worn
              </span>
            )}
            {item.listed && !hideListedBadge && (
              <span className="shrink-0 border border-violet/45 bg-violet/12 px-1.5 text-[9px] uppercase tracking-[0.1em] text-violet">
                Listed
              </span>
            )}
          </div>

          <div className="mt-1 flex items-center gap-2">
            <RarityBadge rarity={item.rarity} size="sm" />
            <span className="tnum text-[10px] text-mute">PWR {power}</span>
          </div>
        </div>
      </div>

      {!compactLayout && (
        <>
          <ul className="mt-2.5 space-y-0.5">
            {(Object.entries(item.stats) as [StatKey, number][]).map(([key, value]) => (
              <li
                key={key}
                className={cn(
                  "tnum text-[11px]",
                  isStatBeneficial(key, value) ? "text-body" : "text-bad"
                )}
              >
                {formatStat(key, value)}
              </li>
            ))}
          </ul>

          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-[0.12em] text-mute">Roll</span>
            <div className="h-1 flex-1 bg-raised">
              <div
                className="h-full"
                style={{ width: `${item.quality}%`, background: meta.color }}
              />
            </div>
            <span className="tnum text-[10px] text-body">{item.quality}%</span>
          </div>
        </>
      )}

      {footer && <div className="mt-3 border-t border-edge pt-2.5">{footer}</div>}
    </div>
  );
}
