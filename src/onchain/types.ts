import type {
  BuildingKind,
  ItemSlot,
  PackKind,
  Rarity,
  ResourceBag,
  ResourceKind,
  StatBlock,
} from "@/sim/types";

/**
 * The account and transaction shapes the game talks to.
 *
 * These are written as if the chain already exists. `MockChainAdapter` fills
 * them from local state today; `SolanaChainAdapter` will fill the exact same
 * shapes by deserialising Anchor accounts. No UI component knows the
 * difference, which is the point — see docs/ONCHAIN.md.
 */

/* ==========================================================================
   Branded primitives

   Branding stops the single most common bug in this kind of codebase: passing
   a listing id where a wallet address is expected. Both are base58 strings, so
   without brands TypeScript would happily allow it.
   ========================================================================== */

export type Address = string & { readonly __brand: "Address" };
export type Signature = string & { readonly __brand: "Signature" };
export type ItemId = string & { readonly __brand: "ItemId" };
export type ListingId = string & { readonly __brand: "ListingId" };
export type CommitId = string & { readonly __brand: "CommitId" };

export const asAddress = (s: string) => s as Address;
export const asSignature = (s: string) => s as Signature;
export const asItemId = (s: string) => s as ItemId;
export const asListingId = (s: string) => s as ListingId;

/* ==========================================================================
   Token

   STRATA is an SPL token with 9 decimals. Every balance in this codebase is a
   `bigint` of base units — never a float. `1.5 STRATA` is `1_500_000_000n`.
   Formatting to a human string happens once, at the edge, in `formatToken`.
   ========================================================================== */

export const STRATA_DECIMALS = 9;
export const STRATA_SYMBOL = "STRATA";
const DECIMAL_FACTOR = 10n ** BigInt(STRATA_DECIMALS);

/** Base units. Use everywhere a token quantity is stored or passed. */
export type Raw = bigint;

/** Whole tokens -> base units. Accepts fractional input safely. */
export function toRaw(ui: number): Raw {
  // Route through a fixed-point string so 0.1 doesn't become 0.09999999.
  const [whole, frac = ""] = ui.toFixed(STRATA_DECIMALS).split(".");
  return BigInt(whole) * DECIMAL_FACTOR + BigInt(frac.padEnd(STRATA_DECIMALS, "0"));
}

/** Base units -> whole tokens as a float. Display only; never for arithmetic. */
export function toUi(raw: Raw): number {
  return Number(raw) / Number(DECIMAL_FACTOR);
}

export interface FormatTokenOptions {
  /** Significant decimals to show. Default 2. */
  decimals?: number;
  /** Compact large numbers as 1.2K / 3.4M. Default true. */
  compact?: boolean;
  /** Append " STRATA". Default false. */
  withSymbol?: boolean;
}

export function formatToken(raw: Raw, options: FormatTokenOptions = {}): string {
  const { decimals = 2, compact = true, withSymbol = false } = options;
  const value = toUi(raw);
  let text: string;

  if (compact && Math.abs(value) >= 1_000_000) {
    text = `${trimZeros((value / 1_000_000).toFixed(2))}M`;
  } else if (compact && Math.abs(value) >= 1_000) {
    text = `${trimZeros((value / 1_000).toFixed(2))}K`;
  } else {
    text = trimZeros(value.toFixed(decimals));
  }

  return withSymbol ? `${text} ${STRATA_SYMBOL}` : text;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/* ==========================================================================
   Accounts
   ========================================================================== */

/** PDA: ["config"] — global, authority-owned, read constantly by the client. */
export interface GameConfig {
  authority: Address;
  /** SPL mint of the in-game currency. Null until the token is deployed. */
  tokenMint: Address | null;
  treasury: Address;
  /** Marketplace fee in basis points. 250 = 2.5%. */
  marketFeeBps: number;
  /** Share of the fee that is burned rather than sent to treasury, in bps. */
  burnShareBps: number;
  packPrices: Record<PackKind, Raw>;
  /** Emergency stop — halts packs, listings and buys. */
  paused: boolean;
  /** Bumped when drop tables change, so historical reveals stay auditable. */
  dropTableVersion: number;
}

/** PDA: ["player", owner] */
export interface PlayerAccount {
  owner: Address;
  /** Deterministically seeds this wallet's terrain. Set once, at init. */
  claimSeed: number;
  createdAt: number;
  level: number;
  xp: number;
  /** Last time passive extractor output was settled on-chain. */
  lastSettledAt: number;
  totalMined: number;
  packsOpened: number;
}

export interface ItemInstance {
  id: ItemId;
  /** Archetype key from `sim/items.ts`. */
  archetype: string;
  slot: ItemSlot;
  rarity: Rarity;
  /** Rolled stats, resolved at mint time from the reveal seed. */
  stats: StatBlock;
  /** Roll quality 0-100; how well the stats rolled inside their range. */
  quality: number;
  mintedAt: number;
  /** Provenance: the reveal that produced it. Lets anyone re-verify the roll. */
  sourceSignature: Signature | null;
  equipped: boolean;
  /** True while the item is escrowed by an active listing. */
  listed: boolean;
}

export interface PlacedBuilding {
  id: string;
  kind: BuildingKind;
  level: number;
  /** Grid position of the building's origin corner, in world voxel space. */
  x: number;
  z: number;
  /** Surface height the footprint was levelled to. */
  y: number;
  rotation: 0 | 1 | 2 | 3;
  placedAt: number;
  /**
   * Extractors only: how far the automated bore has descended, in world y.
   * Starts at the surface and falls over time, so an extractor left running
   * gradually reaches richer strata. Undefined for every other building.
   */
  boreDepth?: number;
}

/* ==========================================================================
   Packs — commit / reveal
   ========================================================================== */

/** PDA: ["commit", owner, nonce] */
export interface PackCommit {
  id: CommitId;
  owner: Address;
  kind: PackKind;
  nonce: number;
  /** sha256(clientSeed), submitted before any entropy is known. */
  clientSeedHash: string;
  /** Slot the commit landed in. The reveal uses the *next* slot's hash. */
  committedSlot: number;
  committedAt: number;
  revealed: boolean;
}

export interface PackReward {
  /** Items minted by this reveal. */
  items: ItemInstance[];
  /** Resources granted alongside them. */
  resources: ResourceBag;
  /** Bonus currency, if the table rolled it. */
  tokens: Raw;
}

export interface PackReveal {
  commitId: CommitId;
  /** The full seed anyone can recompute the roll from. */
  revealSeed: string;
  clientSeed: string;
  slotHash: string;
  dropTableVersion: number;
  reward: PackReward;
}

/* ==========================================================================
   Marketplace
   ========================================================================== */

export interface Listing {
  id: ListingId;
  seller: Address;
  /** Denormalised so a listings grid renders without N extra account reads. */
  item: ItemInstance;
  price: Raw;
  createdAt: number;
  expiresAt: number | null;
  active: boolean;
  /** True when the seller is a simulated market participant, not a real wallet. */
  synthetic: boolean;
}

export interface Offer {
  id: string;
  listingId: ListingId;
  buyer: Address;
  amount: Raw;
  expiresAt: number;
  createdAt: number;
}

export interface ListingQuery {
  slot?: ItemSlot | "all";
  rarity?: Rarity | "all";
  minPrice?: Raw;
  maxPrice?: Raw;
  seller?: Address;
  search?: string;
  sort?: "recent" | "price-asc" | "price-desc" | "rarity";
  limit?: number;
  offset?: number;
}

export interface ListingPage {
  listings: Listing[];
  total: number;
  /** Floor price across the *unfiltered* set, for the market header. */
  floor: Raw | null;
}

/* ==========================================================================
   Staking
   ========================================================================== */

/** PDA: ["stake", owner] */
export interface StakePosition {
  owner: Address;
  amount: Raw;
  lockedUntil: number;
  /** Yield boost granted by this position, in basis points. */
  boostBps: number;
  startedAt: number;
}

/* ==========================================================================
   Transactions
   ========================================================================== */

export interface TxReceipt<T = void> {
  signature: Signature;
  slot: number;
  blockTime: number;
  /**
   * True when produced by the mock adapter. The UI surfaces this so a
   * simulated receipt is never mistaken for a settled on-chain transaction.
   */
  simulated: boolean;
  explorerUrl: string | null;
  /** Compute units / lamports the real transaction would consume. */
  feeLamports: number;
  data: T;
}

export class ChainError extends Error {
  constructor(
    message: string,
    readonly code:
      | "insufficient_funds"
      | "not_connected"
      | "not_found"
      | "paused"
      | "rejected"
      | "invalid_state"
      | "network",
    readonly recoverable = true
  ) {
    super(message);
    this.name = "ChainError";
  }
}

/* ==========================================================================
   Activity feed
   ========================================================================== */

export type ChainEventKind =
  | "pack_opened"
  | "listing_created"
  | "listing_sold"
  | "listing_cancelled"
  | "offer_made"
  | "resources_sold"
  | "yield_claimed"
  | "building_placed"
  | "staked";

export interface ChainEvent {
  id: string;
  kind: ChainEventKind;
  actor: Address;
  at: number;
  signature: Signature;
  /** Pre-rendered summary line for the activity ticker. */
  summary: string;
  rarity?: Rarity;
  amount?: Raw;
}

/* ==========================================================================
   Wallet
   ========================================================================== */

export interface WalletInfo {
  name: string;
  icon: string;
  /** False when the wallet isn't installed — UI shows an install link instead. */
  installed: boolean;
}

export interface WalletState {
  status: "disconnected" | "connecting" | "connected";
  address: Address | null;
  walletName: string | null;
}

/* ==========================================================================
   Aggregate snapshot

   One read that hydrates the whole client. On Solana this becomes a single
   `getMultipleAccounts` call plus a cached listings query, which is why it is
   modelled as one method rather than six.
   ========================================================================== */

export interface PlayerSnapshot {
  player: PlayerAccount;
  balance: Raw;
  resources: ResourceBag;
  items: ItemInstance[];
  buildings: PlacedBuilding[];
  stake: StakePosition | null;
  /** Passive output accrued since `player.lastSettledAt`, claimable now. */
  pendingYield: ResourceBag;
}

export type { BuildingKind, ItemSlot, PackKind, Rarity, ResourceBag, ResourceKind, StatBlock };
