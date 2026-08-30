"use client";

import { useMemo, useState } from "react";
import { useChain } from "@/onchain/ChainProvider";
import { formatToken, toRaw, type ItemInstance } from "@/onchain/types";
import { ARCHETYPE_BY_KEY, salvageValue } from "@/sim/items";
import { ITEM_SLOTS, ITEM_SLOT_META, RARITY_META, type ItemSlot } from "@/sim/types";
import { selectItems, useGame } from "@/sim/store";
import { num } from "@/lib/format";
import { Button, EmptyState, Modal, Tabs, cn } from "@/ui/primitives";
import { IconCube, SLOT_ICONS } from "@/ui/icons";
import { ItemCard } from "../ItemCard";

/**
 * Equipment management.
 *
 * Organised by slot rather than as one flat grid, because the only decision a
 * player actually makes here is "which of my five picks am I wearing" — and a
 * flat grid buries that behind scrolling.
 */
export function InventoryPanel() {
  const items = useGame(selectItems);
  const city = useGame((s) => s.city);
  const [tab, setTab] = useState<ItemSlot | "all">("all");
  const [detail, setDetail] = useState<ItemInstance | null>(null);

  const visible = useMemo(
    () =>
      items
        .filter((item) => tab === "all" || item.slot === tab)
        .sort((a, b) => {
          if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
          const rarity = RARITY_META[b.rarity].tier - RARITY_META[a.rarity].tier;
          return rarity !== 0 ? rarity : b.quality - a.quality;
        }),
    [items, tab]
  );

  const tabs = useMemo(
    () => [
      { id: "all" as const, label: "All", count: items.length },
      ...ITEM_SLOTS.map((slot) => ({
        id: slot,
        label: ITEM_SLOT_META[slot].label,
        count: items.filter((item) => item.slot === slot).length,
      })),
    ],
    [items]
  );

  return (
    <>
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="sticky top-0 z-10 bg-deep px-1" />

      {tab !== "all" && (
        <p className="border-b border-edge bg-crust px-4 py-2.5 text-[11px] leading-relaxed text-mute">
          {ITEM_SLOT_META[tab].blurb}
        </p>
      )}

      <div className="space-y-2 p-3">
        {visible.length === 0 ? (
          <EmptyState
            icon={<IconCube size={30} />}
            title="Nothing here yet"
            message="Supply crates are where equipment comes from. Sell some ore first."
          />
        ) : (
          visible.map((item) => (
            <ItemCard key={item.id} item={item} onClick={() => setDetail(item)} />
          ))
        )}
      </div>

      {items.length > 0 && (
        <p className="px-4 pb-4 text-[11px] leading-relaxed text-faint">
          Equipped stats add together — five items of +6% each beat one of +25%. Assay Lab luck
          stacks on top, up to a hard cap of 60.
          {city.luck > 0 && ` Your lab is contributing +${city.luck} luck.`}
        </p>
      )}

      <ItemDetail item={detail} onClose={() => setDetail(null)} />
    </>
  );
}

/* ==========================================================================
   Detail sheet
   ========================================================================== */

function ItemDetail({ item, onClose }: { item: ItemInstance | null; onClose: () => void }) {
  const { adapter } = useChain();
  const run = useGame((s) => s.run);
  const refresh = useGame((s) => s.refresh);
  const busy = useGame((s) => s.busy);
  const city = useGame((s) => s.city);
  const [listing, setListing] = useState(false);
  const [price, setPrice] = useState("");

  if (!item) return null;

  const archetype = ARCHETYPE_BY_KEY.get(item.archetype);
  const salvage = salvageValue(item.stats, item.rarity, item.quality);
  const Icon = SLOT_ICONS[item.slot];
  const meta = RARITY_META[item.rarity];

  async function act(key: string, action: () => Promise<unknown>, title: string) {
    if (!adapter) return;
    const ok = await run(key, action, () => ({ kind: "success" as const, title }));
    if (ok) {
      await refresh(adapter);
      onClose();
    }
  }

  return (
    <Modal open onClose={onClose} title={archetype?.name ?? "Item"} width="max-w-md">
      <div className="p-5">
        <div className="flex items-start gap-4">
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center border"
            style={{
              borderColor: `${meta.color}45`,
              background: `${meta.color}12`,
              color: meta.color,
              boxShadow: meta.glow > 0.5 ? `0 0 28px -10px ${meta.color}` : undefined,
            }}
          >
            <Icon size={30} />
          </span>
          <div className="min-w-0">
            <p className="text-sm leading-relaxed text-body">{archetype?.flavor}</p>
            <p className="mt-2 text-[11px] text-mute">
              {ITEM_SLOT_META[item.slot].blurb}
            </p>
          </div>
        </div>

        {item.sourceSignature && (
          <div className="mt-4 border border-edge bg-crust p-3">
            <div className="text-[10px] uppercase tracking-[0.13em] text-mute">
              Minted by reveal
            </div>
            <div className="tnum mt-1 break-all text-[10px] text-faint">
              {item.sourceSignature}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-mute">
              The seed behind this roll is public — anyone can recompute it.
            </p>
          </div>
        )}

        {listing ? (
          <div className="mt-5">
            <label className="text-[10px] uppercase tracking-[0.13em] text-mute" htmlFor="price">
              Asking price in STRATA
            </label>
            <input
              id="price"
              type="number"
              min={1}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder={String(Math.round(salvage * 2.2))}
              className="tnum mt-1.5 h-10 w-full border border-edge bg-crust px-3 text-sm text-hi outline-none focus:border-amber"
            />
            <p className="mt-2 text-[11px] text-mute">
              Salvage floor is {num(salvage)}. Market fee is{" "}
              {(city.marketFeeBps / 100).toFixed(2)}% of the sale.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" full onClick={() => setListing(false)}>
                Back
              </Button>
              <Button
                variant="primary"
                full
                loading={busy.has("list")}
                disabled={!price || Number(price) <= 0}
                onClick={() =>
                  act("list", () => adapter!.listItem(item.id, toRaw(Number(price))), "Listed")
                }
              >
                List it
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button
              variant={item.equipped ? "secondary" : "primary"}
              full
              loading={busy.has("equip")}
              disabled={item.listed}
              onClick={() =>
                act(
                  "equip",
                  () =>
                    item.equipped
                      ? adapter!.unequipItem(item.id)
                      : adapter!.equipItem(item.id),
                  item.equipped ? "Unequipped" : "Equipped"
                )
              }
            >
              {item.equipped ? "Take off" : "Equip"}
            </Button>

            <Button
              variant="secondary"
              full
              disabled={item.listed || !city.hasMarket}
              title={city.hasMarket ? undefined : "Build a Market Hub first"}
              onClick={() => setListing(true)}
            >
              Sell on market
            </Button>

            <Button
              variant="danger"
              full
              className="col-span-2"
              loading={busy.has("salvage")}
              disabled={item.listed}
              onClick={() =>
                act("salvage", () => adapter!.salvageItem(item.id), `Salvaged for ${num(salvage)}`)
              }
            >
              Salvage for {formatToken(toRaw(salvage))}
            </Button>
          </div>
        )}

        {item.listed && (
          <p className={cn("mt-3 border border-violet/40 bg-violet/10 px-3 py-2 text-[11px] text-violet")}>
            This item is escrowed by an active listing. Cancel it from the Marketplace panel to
            get it back.
          </p>
        )}
      </div>
    </Modal>
  );
}
