import { Rng, base58Encode } from "@/lib/rng";
import { ARCHETYPES_BY_SLOT, itemPower, rollItem, salvageValue } from "@/sim/items";
import { ITEM_SLOTS, RARITIES, type ItemSlot, type Rarity } from "@/sim/types";
import type { Address, ItemInstance, Listing, ListingId, Signature } from "../types";
import { asAddress, asItemId, asListingId, toRaw } from "../types";
import type { LeaderboardRow } from "../adapter";

/**
 * Simulated market participants.
 *
 * An empty marketplace teaches a player nothing — they can't tell whether a
 * price is good, what a Legendary roll looks like, or whether listing is worth
 * doing. So the mock ships with a populated order book that drifts over time.
 *
 * Every synthetic row is flagged `synthetic: true` and the UI marks it
 * visibly. A simulated economy that pretends to be a real one is how people
 * end up making decisions on numbers that were never real, and the point of
 * this build is to be honest about what is and isn't wired up yet.
 */

const MARKET_SEED = 0x5241_5441; // "RATA"

const HOUSE_NAMES = [
  "Deepvein",
  "Corewright",
  "Slagheap",
  "Nine Fathom",
  "Blackseam",
  "Ironhaul",
  "Cinderworks",
  "Quarrylight",
  "Basalt Row",
  "Underlight",
  "Coldshaft",
  "Hollowmark",
  "Emberpit",
  "Greywater Dig",
  "Sable Bore",
  "Kestrel Mining",
  "Longshadow",
  "Marrowstone",
  "Tailings Co.",
  "Adit Seven",
  "Gantry & Vale",
  "Nightcut",
  "Ochre Works",
  "Pitwall",
];

/**
 * Rarity spread of what actually reaches a marketplace.
 *
 * Deliberately richer than the pack tables: players salvage their commons and
 * only bother listing things worth listing. That's what a real market for a
 * game like this looks like, and it means the listings grid shows off the
 * rarity ladder instead of being a wall of grey.
 */
const MARKET_RARITY_WEIGHTS: Array<[Rarity, number]> = [
  ["common", 16],
  ["uncommon", 30],
  ["rare", 31],
  ["epic", 16],
  ["legendary", 6],
  ["mythic", 1],
];

function pickRarity(rng: Rng): Rarity {
  const total = MARKET_RARITY_WEIGHTS.reduce((n, [, w]) => n + w, 0);
  let target = rng.float() * total;
  for (const [rarity, weight] of MARKET_RARITY_WEIGHTS) {
    target -= weight;
    if (target <= 0) return rarity;
  }
  return "common";
}

function bytesFromRng(rng: Rng, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = rng.int(0, 255);
  return out;
}

/** A base58 string the same shape as a real Solana address. */
export function syntheticAddress(rng: Rng): Address {
  return asAddress(base58Encode(bytesFromRng(rng, 32)));
}

/** A base58 string the same shape as a real transaction signature. */
export function syntheticSignature(rng: Rng): Signature {
  return base58Encode(bytesFromRng(rng, 64)) as Signature;
}

export function syntheticName(rng: Rng): string {
  const base = rng.pick(HOUSE_NAMES);
  return rng.bool(0.35) ? `${base} ${rng.int(2, 89)}` : base;
}

/* ==========================================================================
   Listings
   ========================================================================== */

function makeItem(rng: Rng, index: number): ItemInstance {
  const rarity = pickRarity(rng);
  const slot: ItemSlot = rng.pick(ITEM_SLOTS);
  const archetype = rng.pick(ARCHETYPES_BY_SLOT[slot]);
  const seed = bytesFromRng(rng, 32);
  const rolled = rollItem(archetype, rarity, seed, index);

  return {
    id: asItemId(`syn_${base58Encode(bytesFromRng(rng, 12))}`),
    archetype: archetype.key,
    slot,
    rarity,
    stats: rolled.stats,
    quality: rolled.quality,
    mintedAt: Date.now() - rng.int(60_000, 40 * 86_400_000),
    sourceSignature: null,
    equipped: false,
    listed: true,
  };
}

/**
 * Prices an item the way a player would: anchored to salvage value, then
 * spread wide. Roughly one listing in seven is a genuine bargain, which is
 * what makes browsing worth doing at all.
 */
function priceFor(rng: Rng, item: ItemInstance): number {
  const anchor = salvageValue(item.stats, item.rarity, item.quality);
  const power = itemPower(item.stats, item.rarity);

  // Market price sits above salvage — salvage is the floor, not the going rate.
  let multiplier = 2.1 + power / 260;

  if (rng.bool(0.14)) multiplier *= rng.range(0.55, 0.82); // underpriced
  else if (rng.bool(0.22)) multiplier *= rng.range(1.4, 2.3); // optimistic
  else multiplier *= rng.range(0.92, 1.25);

  const raw = anchor * multiplier;
  // Round to something a human would type.
  const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
  return Math.max(25, Math.round(raw / magnitude) * magnitude);
}

function makeListing(rng: Rng, index: number, now: number): Listing {
  const item = makeItem(rng, index);
  const seller = syntheticAddress(rng);
  const ageMs = rng.int(30_000, 9 * 86_400_000);

  return {
    id: asListingId(`syn_l_${base58Encode(bytesFromRng(rng, 10))}`),
    seller,
    item,
    price: toRaw(priceFor(rng, item)),
    createdAt: now - ageMs,
    expiresAt: null,
    active: true,
    synthetic: true,
  };
}

export function seedMarket(count = 64, now = Date.now()): Listing[] {
  const rng = new Rng(MARKET_SEED);
  const listings: Listing[] = [];
  for (let i = 0; i < count; i++) listings.push(makeListing(rng, i, now));
  return listings.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Advances the synthetic side of the market.
 *
 * Called on read rather than on a timer: there is no server here, so "time
 * passing" has to be computed from the gap since the last observation. One
 * listing turns over roughly every 40 seconds of real elapsed time, capped so
 * that returning after a week doesn't churn the entire book at once.
 */
export function tickMarket(
  listings: Listing[],
  lastTick: number,
  now = Date.now()
): { listings: Listing[]; sold: Listing[]; changed: boolean } {
  if (lastTick === 0) return { listings, sold: [], changed: false };

  const elapsed = now - lastTick;
  const turnovers = Math.min(12, Math.floor(elapsed / 40_000));
  if (turnovers <= 0) return { listings, sold: [], changed: false };

  // Seed from the time bucket so repeated reads in the same window agree.
  const rng = new Rng(MARKET_SEED ^ Math.floor(now / 40_000));
  const next = [...listings];
  const sold: Listing[] = [];

  for (let i = 0; i < turnovers; i++) {
    const synthetic = next.filter((l) => l.synthetic && l.active);
    if (synthetic.length === 0) break;

    // Underpriced listings sell first — the same reason they do in a real market.
    synthetic.sort((a, b) => {
      const av = salvageValue(a.item.stats, a.item.rarity, a.item.quality);
      const bv = salvageValue(b.item.stats, b.item.rarity, b.item.quality);
      return Number(a.price) / av - Number(b.price) / bv;
    });

    const target = synthetic[Math.min(synthetic.length - 1, Math.floor(Math.abs(rng.float()) * 3))];
    const idx = next.findIndex((l) => l.id === target.id);
    if (idx >= 0) {
      sold.push(next[idx]);
      next.splice(idx, 1);
    }
    next.unshift(makeListing(rng, i, now - rng.int(0, 30_000)));
  }

  return { listings: next, sold, changed: true };
}

/* ==========================================================================
   Leaderboard
   ========================================================================== */

export function syntheticLeaderboard(count = 24): LeaderboardRow[] {
  const rng = new Rng(MARKET_SEED ^ 0x1eed);
  const rows: LeaderboardRow[] = [];

  for (let i = 0; i < count; i++) {
    // A power-law-ish curve — the top of a mining leaderboard is always steep.
    const scale = Math.pow(0.86, i);
    rows.push({
      rank: i + 1,
      address: syntheticAddress(rng),
      displayName: syntheticName(rng),
      level: Math.max(1, Math.round(46 * scale + rng.range(-2, 2))),
      totalMined: Math.round(1_480_000 * scale * rng.range(0.85, 1.15)),
      netWorth: toRaw(Math.round(6_200_000 * scale * rng.range(0.8, 1.2))),
      synthetic: true,
    });
  }

  return rows;
}

/** Recomputes ranks after the real player is spliced in. */
export function rerank(rows: LeaderboardRow[]): LeaderboardRow[] {
  return rows
    .sort((a, b) => (b.netWorth > a.netWorth ? 1 : b.netWorth < a.netWorth ? -1 : 0))
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function listingIdOf(id: string): ListingId {
  return asListingId(id);
}

export { RARITIES };
