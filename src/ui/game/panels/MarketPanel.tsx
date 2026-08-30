"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useChain } from "@/onchain/ChainProvider";
import {
  formatToken,
  toUi,
  type Listing,
  type ListingQuery,
  type Raw,
} from "@/onchain/types";
import { ARCHETYPE_BY_KEY, itemPower, salvageValue } from "@/sim/items";
import { ITEM_SLOTS, ITEM_SLOT_META, RARITIES, RARITY_META, type ItemSlot, type Rarity } from "@/sim/types";
import { useGame } from "@/sim/store";
import { shortenAddress } from "@/onchain/wallet/standard";
import { num, relativeTime } from "@/lib/format";
import { Button, Chip, EmptyState, Spinner, Tabs, cn } from "@/ui/primitives";
import { IconMarket, IconSearch } from "@/ui/icons";
import { ItemCard } from "../ItemCard";

/**
 * The marketplace.
 *
 * Each row shows price *relative to salvage value*, because that ratio is the
 * only thing that makes a price meaningful. "4,200 STRATA" tells a player
 * nothing; "1.4× salvage" tells them whether it's a deal.
 */

const SORTS: Array<{ id: NonNullable<ListingQuery["sort"]>; label: string }> = [
  { id: "recent", label: "Newest" },
  { id: "price-asc", label: "Cheapest" },
  { id: "price-desc", label: "Priciest" },
  { id: "rarity", label: "Rarest" },
];

export function MarketPanel() {
  const [tab, setTab] = useState<"browse" | "mine">("browse");
  return (
    <>
      <Tabs
        tabs={[
          { id: "browse", label: "Browse" },
          { id: "mine", label: "My listings" },
        ]}
        value={tab}
        onChange={setTab}
        className="sticky top-0 z-10 bg-deep px-1"
      />
      {tab === "browse" ? <Browse /> : <MyListings />}
    </>
  );
}

/* ==========================================================================
   Browse
   ========================================================================== */

function Browse() {
  const { adapter } = useChain();
  const balance = useGame((s) => s.snapshot?.balance ?? 0n);
  const busy = useGame((s) => s.busy);
  const run = useGame((s) => s.run);
  const refresh = useGame((s) => s.refresh);

  const [slot, setSlot] = useState<ItemSlot | "all">("all");
  const [rarity, setRarity] = useState<Rarity | "all">("all");
  const [sort, setSort] = useState<NonNullable<ListingQuery["sort"]>>("recent");
  const [search, setSearch] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [floor, setFloor] = useState<Raw | null>(null);
  const [loading, setLoading] = useState(true);

  // Stale-while-revalidate: the previous results stay on screen while a new
  // query runs. Blanking the grid on every filter change is worse to use, and
  // it keeps this free of synchronous state writes inside an effect.
  const load = useCallback(async () => {
    if (!adapter) return;
    try {
      const page = await adapter.getListings({ slot, rarity, sort, search, limit: 40 });
      setListings(page.listings);
      setTotal(page.total);
      setFloor(page.floor);
    } finally {
      setLoading(false);
    }
  }, [adapter, slot, rarity, sort, search]);

  useEffect(() => {
    // Debounced so typing in the search box doesn't fire a request per keypress.
    const timer = setTimeout(() => void load(), search ? 260 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <>
      <div className="space-y-2.5 border-b border-edge p-3">
        <div className="relative">
          <IconSearch
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, slot or rarity"
            className="h-9 w-full border border-edge bg-crust pl-8 pr-3 text-[12px] text-hi outline-none placeholder:text-faint focus:border-amber"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip active={slot === "all"} onClick={() => setSlot("all")}>
            All slots
          </Chip>
          {ITEM_SLOTS.map((entry) => (
            <Chip key={entry} active={slot === entry} onClick={() => setSlot(entry)}>
              {ITEM_SLOT_META[entry].label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip active={rarity === "all"} onClick={() => setRarity("all")}>
            Any rarity
          </Chip>
          {RARITIES.map((entry) => (
            <Chip
              key={entry}
              active={rarity === entry}
              onClick={() => setRarity(entry)}
              color={RARITY_META[entry].color}
            >
              {RARITY_META[entry].label}
            </Chip>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {SORTS.map((entry) => (
              <Chip key={entry.id} active={sort === entry.id} onClick={() => setSort(entry.id)}>
                {entry.label}
              </Chip>
            ))}
          </div>
          {floor !== null && (
            <span className="tnum shrink-0 text-[10px] text-mute">
              floor {formatToken(floor)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-mute">
        <span>
          {loading ? "Loading…" : `${num(total)} listing${total === 1 ? "" : "s"}`}
        </span>
        <button onClick={() => void load()} className="text-amber hover:text-amber-hi">
          Refresh
        </button>
      </div>

      {loading && listings.length === 0 ? (
        <div className="flex justify-center py-16 text-mute">
          <Spinner size={20} />
        </div>
      ) : listings.length === 0 ? (
        <EmptyState
          icon={<IconMarket size={30} />}
          title="Nothing matches"
          message="Try widening the filters."
        />
      ) : (
        <div className="grid gap-2 p-3 lg:grid-cols-2">
          {listings.map((listing) => {
            const salvage = salvageValue(
              listing.item.stats,
              listing.item.rarity,
              listing.item.quality
            );
            const ratio = toUi(listing.price) / Math.max(1, salvage);
            const affordable = balance >= listing.price;

            return (
              <ItemCard
                key={listing.id}
                item={listing.item}
                footer={
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="tnum text-[15px] font-semibold text-amber">
                        {formatToken(listing.price)}
                      </span>
                      <span
                        className={cn(
                          "tnum text-[10px]",
                          ratio < 1.6 ? "text-good" : ratio > 3 ? "text-bad" : "text-mute"
                        )}
                        title={`Salvage value is ${num(salvage)} STRATA`}
                      >
                        {ratio.toFixed(1)}× salvage
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[10px] text-faint">
                      <span className="tnum">
                        {listing.synthetic ? "simulated seller" : shortenAddress(listing.seller)}
                      </span>
                      <span>{relativeTime(listing.createdAt)}</span>
                    </div>

                    <Button
                      size="sm"
                      variant={affordable ? "primary" : "secondary"}
                      full
                      className="mt-2"
                      disabled={!affordable}
                      loading={busy.has(`buy-${listing.id}`)}
                      onClick={async () => {
                        if (!adapter) return;
                        const ok = await run(
                          `buy-${listing.id}`,
                          () => adapter.buyListing(listing.id),
                          (receipt) => ({
                            kind: "success" as const,
                            title: "Purchased",
                            message: `Paid ${formatToken(receipt.data.paid)} plus ${formatToken(
                              receipt.data.fee
                            )} fee`,
                            signature: receipt.signature,
                          })
                        );
                        if (ok) {
                          await Promise.all([refresh(adapter), load()]);
                        }
                      }}
                    >
                      {affordable ? "Buy" : "Too expensive"}
                    </Button>
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}

/* ==========================================================================
   My listings
   ========================================================================== */

function MyListings() {
  const { adapter } = useChain();
  const address = useGame((s) => s.address);
  const busy = useGame((s) => s.busy);
  const run = useGame((s) => s.run);
  const refresh = useGame((s) => s.refresh);
  const city = useGame((s) => s.city);

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!adapter || !address) return;
    try {
      const page = await adapter.getListings({ seller: address, limit: 50 });
      setListings(page.listings);
    } finally {
      setLoading(false);
    }
  }, [adapter, address]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalAsk = useMemo(
    () => listings.reduce((sum, listing) => sum + listing.price, 0n),
    [listings]
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-mute">
        <Spinner size={20} />
      </div>
    );
  }

  if (!city.hasMarket) {
    return (
      <EmptyState
        icon={<IconMarket size={30} />}
        title="No Market Hub"
        message="You need a Market Hub in your city before you can list anything. It unlocks at level 3."
      />
    );
  }

  if (listings.length === 0) {
    return (
      <EmptyState
        icon={<IconMarket size={30} />}
        title="Nothing listed"
        message="Open an item from your Equipment panel and choose 'Sell on market'."
      />
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between border-b border-edge px-4 py-2.5 text-[11px]">
        <span className="text-mute">{listings.length} active</span>
        <span className="tnum text-body">{formatToken(totalAsk)} asked</span>
      </div>

      <div className="space-y-2 p-3">
        {listings.map((listing) => (
          <ItemCard
            key={listing.id}
            item={listing.item}
            footer={
              <div className="flex items-center gap-2">
                <span className="tnum flex-1 text-[14px] font-semibold text-amber">
                  {formatToken(listing.price)}
                </span>
                <span className="tnum text-[10px] text-faint">
                  PWR {itemPower(listing.item.stats, listing.item.rarity)}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy.has(`cancel-${listing.id}`)}
                  onClick={async () => {
                    if (!adapter) return;
                    const ok = await run(
                      `cancel-${listing.id}`,
                      () => adapter.cancelListing(listing.id),
                      () => ({ kind: "info" as const, title: "Listing cancelled" })
                    );
                    if (ok) await Promise.all([refresh(adapter), load()]);
                  }}
                >
                  Cancel
                </Button>
              </div>
            }
          />
        ))}
      </div>
    </>
  );
}

export { ARCHETYPE_BY_KEY };
