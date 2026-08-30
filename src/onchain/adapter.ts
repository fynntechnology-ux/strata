import type {
  Address,
  ChainEvent,
  GameConfig,
  ItemId,
  Listing,
  ListingId,
  ListingPage,
  ListingQuery,
  Offer,
  PackCommit,
  PackReveal,
  PlacedBuilding,
  PlayerSnapshot,
  Raw,
  StakePosition,
  TxReceipt,
  WalletInfo,
  WalletState,
} from "./types";
import type { BuildingKind, PackKind, ResourceBag } from "@/sim/types";

/**
 * The single seam between STRATA and a blockchain.
 *
 * Everything the game can do that touches ownership or currency goes through
 * this interface. Two implementations exist:
 *
 *   - `MockChainAdapter`   — today. Local, deterministic, instant, free.
 *   - `SolanaChainAdapter` — the real thing. Same signatures, same shapes.
 *
 * Rules that keep the swap cheap, and which are worth defending in review:
 *
 *   1. No UI file may import an adapter implementation directly. They consume
 *      `useChain()` and get whichever one the environment selected.
 *   2. Every mutating call returns a `TxReceipt`, even in mock mode. The UI
 *      already renders signatures, confirmation states and explorer links, so
 *      nothing has to be retrofitted when those become real.
 *   3. Every call can fail and can be slow. The mock deliberately injects
 *      latency and lets you force failures, because "works against an instant
 *      infallible backend" is how you end up shipping a UI with no error paths.
 *   4. Reads are pull-based and cheap to poll; writes are explicit user actions.
 */
export interface ChainAdapter {
  readonly kind: "mock" | "solana";
  /** "simulated" | "devnet" | "mainnet-beta" */
  readonly cluster: string;
  /** Human label for the network chip in the header. */
  readonly label: string;

  /* ---- wallet ---------------------------------------------------------- */

  getWalletState(): WalletState;
  listWallets(): WalletInfo[];
  connect(walletName?: string): Promise<WalletState>;
  disconnect(): Promise<void>;
  /** Fires on connect/disconnect/account change. Returns an unsubscribe fn. */
  onWalletChange(listener: (state: WalletState) => void): () => void;

  /* ---- reads ----------------------------------------------------------- */

  getConfig(): Promise<GameConfig>;
  /** Null when the wallet has never initialised a claim. */
  getSnapshot(owner: Address): Promise<PlayerSnapshot | null>;
  getBalance(owner: Address): Promise<Raw>;
  getListings(query?: ListingQuery): Promise<ListingPage>;
  getListing(id: ListingId): Promise<Listing | null>;
  getOffers(listingId: ListingId): Promise<Offer[]>;
  getRecentEvents(limit?: number): Promise<ChainEvent[]>;
  getLeaderboard(limit?: number): Promise<LeaderboardRow[]>;

  /* ---- player ---------------------------------------------------------- */

  initPlayer(): Promise<TxReceipt<PlayerSnapshot>>;

  /**
   * Settles passive extractor output.
   *
   * Deliberately explicit rather than continuous: the client accrues a
   * *projection* locally and the player commits it in one transaction. That
   * keeps the on-chain write count to one per claim instead of one per tick,
   * and it means the authoritative number is computed by the program from
   * elapsed slots, not handed to it by the client.
   */
  claimYield(): Promise<TxReceipt<{ granted: ResourceBag }>>;

  /**
   * Commits resources the player dug by hand.
   *
   * The anti-cheat story lives here, so it is worth stating plainly: the
   * client is *not* trusted with this number. `energySpent` is the bound. A
   * player's energy is a pure function of elapsed time and their equipment, so
   * the program can independently compute the maximum energy that could have
   * accrued since the last settlement, and reject any batch claiming more.
   * Yield per unit energy is likewise capped by equipment the program can see.
   *
   * A cheater who patches the client can therefore choose *which* resources to
   * claim, but not *how much* — which turns a total break into a preference.
   * See docs/SECURITY.md.
   */
  settleMining(bag: ResourceBag, energySpent: number): Promise<TxReceipt<{ granted: ResourceBag }>>;

  /** Sells resources to the sink at the config's posted rates. Mints currency. */
  sellResources(bag: ResourceBag): Promise<TxReceipt<{ proceeds: Raw }>>;

  /** Spends resources + currency to refine raw ore into a higher tier. */
  refine(input: ResourceBag): Promise<TxReceipt<{ produced: ResourceBag }>>;

  /* ---- city ------------------------------------------------------------ */

  /**
   * `y` is supplied by the caller because the client owns the terrain: the
   * program stores where a building sits, it does not re-derive ground height.
   * On-chain this is validated against the claim seed, which is enough to
   * reject a building placed inside a mountain without shipping worldgen to
   * the program.
   */
  placeBuilding(
    kind: BuildingKind,
    x: number,
    y: number,
    z: number,
    rotation: 0 | 1 | 2 | 3
  ): Promise<TxReceipt<PlacedBuilding>>;
  upgradeBuilding(id: string): Promise<TxReceipt<PlacedBuilding>>;
  removeBuilding(id: string): Promise<TxReceipt<void>>;

  /* ---- equipment ------------------------------------------------------- */

  equipItem(id: ItemId): Promise<TxReceipt<void>>;
  unequipItem(id: ItemId): Promise<TxReceipt<void>>;
  /** Destroys an item for currency. The main item sink. */
  salvageItem(id: ItemId): Promise<TxReceipt<{ proceeds: Raw }>>;

  /* ---- packs (commit / reveal) ----------------------------------------- */

  /**
   * Step 1: burn the pack price and lock in a hash of the client's secret.
   * At this point nobody — player, server or validator — can predict the roll.
   */
  commitPack(kind: PackKind): Promise<TxReceipt<PackCommit>>;

  /**
   * Step 2: publish the secret. The program checks it against the committed
   * hash, mixes in a slot hash that did not exist at commit time, and mints
   * the result. Anyone can recompute it from the two transactions.
   */
  revealPack(commitId: string): Promise<TxReceipt<PackReveal>>;

  /** Commits that were never revealed — the UI nags the player to finish them. */
  getPendingCommits(owner: Address): Promise<PackCommit[]>;

  /* ---- marketplace ----------------------------------------------------- */

  listItem(id: ItemId, price: Raw): Promise<TxReceipt<Listing>>;
  cancelListing(id: ListingId): Promise<TxReceipt<void>>;
  buyListing(id: ListingId): Promise<TxReceipt<{ paid: Raw; fee: Raw }>>;
  makeOffer(id: ListingId, amount: Raw, ttlSeconds: number): Promise<TxReceipt<Offer>>;
  acceptOffer(offerId: string): Promise<TxReceipt<{ proceeds: Raw }>>;

  /* ---- staking --------------------------------------------------------- */

  stake(amount: Raw, lockDays: number): Promise<TxReceipt<StakePosition>>;
  unstake(): Promise<TxReceipt<{ returned: Raw }>>;
}

export interface LeaderboardRow {
  rank: number;
  address: Address;
  displayName: string;
  level: number;
  totalMined: number;
  netWorth: Raw;
  /** True for simulated participants. Rendered with a distinct marker. */
  synthetic: boolean;
}

/* ==========================================================================
   Selection
   ========================================================================== */

export type ChainMode = "mock" | "devnet" | "mainnet-beta";

/**
 * Reads NEXT_PUBLIC_CHAIN_MODE. Defaults to `mock`, and *stays* mock unless a
 * program id is also configured — a half-configured deployment should fall
 * back to something playable rather than throwing on first render.
 */
export function resolveChainMode(): ChainMode {
  const raw = process.env.NEXT_PUBLIC_CHAIN_MODE?.trim().toLowerCase();
  if (raw === "devnet" || raw === "mainnet-beta") {
    if (!process.env.NEXT_PUBLIC_PROGRAM_ID) {
      if (typeof console !== "undefined") {
        console.warn(
          `[strata] NEXT_PUBLIC_CHAIN_MODE=${raw} but NEXT_PUBLIC_PROGRAM_ID is unset. ` +
            `Falling back to mock mode.`
        );
      }
      return "mock";
    }
    return raw;
  }
  return "mock";
}
