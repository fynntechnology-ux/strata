import {
  Rng,
  base58Encode,
  bytesToHex,
  concatBytes,
  hexToBytes,
  randomBytes,
  seedFromString,
  sha256,
} from "@/lib/rng";
import {
  BUILDING_DEFS,
  buildingCost,
} from "@/sim/buildings";
import {
  BASE,
  aggregateItemStats,
  canAfford,
  currentEnergy,
  derivePlayerStats,
  deriveCityStats,
  levelFromXp,
  marketFeeSplit,
  miningEnergyCost,
  miningYield,
  saleProceeds,
  simulateProduction,
} from "@/sim/economy";
import { ARCHETYPE_BY_KEY, itemPower, rollItem, salvageValue } from "@/sim/items";
import { DROP_TABLE_VERSION, PACK_DEFS, openPack } from "@/sim/packs";
import {
  RECIPES,
  RESOURCE_DEFS,
  bagAdd,
  bagCovers,
  bagMerge,
  bagSubtract,
  bagTotal,
} from "@/sim/resources";
import { SURFACE_Y } from "@/sim/strata";
import { RARITIES, type BuildingKind, type PackKind, type ResourceBag, type ResourceKind } from "@/sim/types";
import type { ChainAdapter, LeaderboardRow } from "../adapter";
import {
  ChainError,
  asAddress,
  asItemId,
  asListingId,
  asSignature,
  toRaw,
  toUi,
  type Address,
  type ChainEvent,
  type ChainEventKind,
  type GameConfig,
  type ItemId,
  type ItemInstance,
  type Listing,
  type ListingId,
  type ListingPage,
  type ListingQuery,
  type Offer,
  type PackCommit,
  type PackReveal,
  type PlacedBuilding,
  type PlayerAccount,
  type PlayerSnapshot,
  type Raw,
  type StakePosition,
  type TxReceipt,
  type WalletInfo,
  type WalletState,
} from "../types";
import {
  connectWallet,
  disconnectWallet,
  discoverWallets,
  onWalletsChanged,
} from "../wallet/standard";
import {
  KEYS,
  loadGlobal,
  loadPlayer,
  readKey,
  removeKey,
  resetAll,
  savePlayer,
  saveGlobal,
  writeKey,
  type MockGlobalState,
  type MockPlayerState,
  type StoredCommit,
} from "./state";
import { rerank, seedMarket, syntheticLeaderboard, tickMarket } from "./synthetic";

/**
 * A complete, playable chain that does not exist.
 *
 * This implements every operation STRATA needs, locally and deterministically,
 * with the same shapes, the same failure modes and the same two-step pack
 * commit/reveal the real program will use. It is not a stub: the economy runs,
 * the market moves, balances can go to zero, and transactions can fail.
 *
 * Three things it does on purpose that a naive mock would not:
 *
 *  - **It is slow.** Every call sleeps. A UI developed against an instant
 *    backend has no loading states, and retrofitting them later is miserable.
 *  - **It refuses.** Insufficient funds, missing prerequisites and bad state
 *    all throw `ChainError` with the same codes the Solana adapter will.
 *  - **It is verifiable.** Pack reveals publish their seed, and
 *    `scripts/verify-reveal.ts` recomputes them from the drop tables. That
 *    property has to be designed in from the start, not added at launch.
 */
export class MockChainAdapter implements ChainAdapter {
  readonly kind = "mock" as const;
  readonly cluster = "simulated";
  readonly label = "Simulated";

  static readonly DEMO_WALLET = "Demo Wallet";

  #wallet: WalletState = { status: "disconnected", address: null, walletName: null };
  #listeners = new Set<(state: WalletState) => void>();
  #global: MockGlobalState;
  #walletsUnsub: (() => void) | null = null;

  constructor() {
    this.#global = loadGlobal();
    if (!this.#global.syntheticSeeded) {
      this.#global.listings = seedMarket();
      this.#global.syntheticSeeded = true;
      this.#global.lastMarketTick = Date.now();
      saveGlobal(this.#global);
    }
    if (typeof window !== "undefined") {
      // Wallets inject asynchronously; re-notify so the picker updates.
      this.#walletsUnsub = onWalletsChanged(() => this.#notify());
    }
  }

  dispose(): void {
    this.#walletsUnsub?.();
    this.#listeners.clear();
  }

  /* ======================================================================
     Simulated chain primitives
     ====================================================================== */

  /** Solana produces a slot roughly every 400ms. Close enough to feel real. */
  #slot(): number {
    return Math.floor(Date.now() / 400);
  }

  #signature(): string {
    return base58Encode(randomBytes(64));
  }

  async #delay(min = 180, max = 520): Promise<void> {
    const ms = min + Math.random() * (max - min);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  #receipt<T>(data: T, feeLamports = 5_000): TxReceipt<T> {
    return {
      signature: asSignature(this.#signature()),
      slot: this.#slot(),
      blockTime: Date.now(),
      simulated: true,
      explorerUrl: null,
      feeLamports,
      data,
    };
  }

  #emit(
    kind: ChainEventKind,
    summary: string,
    signature: string,
    extra: Partial<ChainEvent> = {}
  ): void {
    const event: ChainEvent = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind,
      actor: this.#wallet.address ?? asAddress("unknown"),
      at: Date.now(),
      signature: asSignature(signature),
      summary,
      ...extra,
    };
    this.#global.events = [event, ...this.#global.events].slice(0, 200);
    saveGlobal(this.#global);
  }

  /* ======================================================================
     Wallet
     ====================================================================== */

  getWalletState(): WalletState {
    return this.#wallet;
  }

  listWallets(): WalletInfo[] {
    const discovered = discoverWallets().map((w) => ({
      name: w.name,
      icon: w.icon,
      installed: true,
    }));
    return [
      ...discovered,
      {
        name: MockChainAdapter.DEMO_WALLET,
        icon: DEMO_WALLET_ICON,
        installed: true,
      },
    ];
  }

  async connect(walletName?: string): Promise<WalletState> {
    this.#setWallet({ status: "connecting", address: null, walletName: walletName ?? null });
    await this.#delay(220, 480);

    try {
      if (!walletName || walletName === MockChainAdapter.DEMO_WALLET) {
        const address = this.#demoWalletAddress();
        return this.#setWallet({
          status: "connected",
          address,
          walletName: MockChainAdapter.DEMO_WALLET,
        });
      }

      const found = discoverWallets().find((w) => w.name === walletName);
      if (!found) {
        throw new ChainError(`${walletName} is not available`, "not_connected");
      }

      // Read-only: we take the address so a claim is seeded from the real
      // pubkey and carries over when the chain is live. Nothing is signed.
      const address = await connectWallet(found.wallet);
      if (!address) throw new ChainError("Wallet returned no account", "rejected");

      return this.#setWallet({
        status: "connected",
        address: asAddress(address),
        walletName,
      });
    } catch (error) {
      this.#setWallet({ status: "disconnected", address: null, walletName: null });
      if (error instanceof ChainError) throw error;
      throw new ChainError(
        error instanceof Error ? error.message : "Wallet connection was rejected",
        "rejected"
      );
    }
  }

  async disconnect(): Promise<void> {
    const name = this.#wallet.walletName;
    if (name && name !== MockChainAdapter.DEMO_WALLET) {
      const found = discoverWallets().find((w) => w.name === name);
      if (found) await disconnectWallet(found.wallet).catch(() => {});
    }
    this.#setWallet({ status: "disconnected", address: null, walletName: null });
  }

  onWalletChange(listener: (state: WalletState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #setWallet(state: WalletState): WalletState {
    this.#wallet = state;
    this.#notify();
    return state;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#wallet);
  }

  #demoWalletAddress(): Address {
    const existing = readKey(KEYS.demoWallet);
    if (existing) return asAddress(existing);
    const address = base58Encode(randomBytes(32));
    writeKey(KEYS.demoWallet, address);
    return asAddress(address);
  }

  #requireAddress(): Address {
    if (this.#wallet.status !== "connected" || !this.#wallet.address) {
      throw new ChainError("Connect a wallet first", "not_connected");
    }
    return this.#wallet.address;
  }

  #requirePlayer(): { address: Address; state: MockPlayerState } {
    const address = this.#requireAddress();
    const state = loadPlayer(address);
    if (!state) throw new ChainError("No claim registered for this wallet", "not_found");
    return { address, state };
  }

  /* ======================================================================
     Config
     ====================================================================== */

  async getConfig(): Promise<GameConfig> {
    await this.#delay(40, 110);
    return {
      authority: asAddress("Simu1atedAuth0rityNotYetDep1oyed11111111111"),
      tokenMint: null, // No token exists yet. This is the honest answer.
      treasury: asAddress("Simu1atedTreasury11111111111111111111111111"),
      marketFeeBps: BASE.marketFeeBps,
      burnShareBps: 4_000, // 40% of the fee is burned, 60% funds the treasury
      packPrices: {
        supply: toRaw(PACK_DEFS.supply.priceTokens),
        prospector: toRaw(PACK_DEFS.prospector.priceTokens),
        deepcore: toRaw(PACK_DEFS.deepcore.priceTokens),
      },
      paused: false,
      dropTableVersion: DROP_TABLE_VERSION,
    };
  }

  /* ======================================================================
     Reads
     ====================================================================== */

  async getSnapshot(owner: Address): Promise<PlayerSnapshot | null> {
    await this.#delay(60, 170);
    const state = loadPlayer(owner);
    if (!state) return null;
    return this.#snapshotFrom(state);
  }

  #snapshotFrom(state: MockPlayerState): PlayerSnapshot {
    const city = deriveCityStats(state.buildings);
    const itemStats = aggregateItemStats(state.items);
    const { level } = levelFromXp(state.player.xp);
    const stats = derivePlayerStats(itemStats, city, level);

    const elapsed = Math.max(0, (Date.now() - state.player.lastSettledAt) / 1000);
    const projection = simulateProduction({
      buildings: state.buildings,
      resources: state.resources,
      city,
      stats,
      elapsedSeconds: elapsed,
    });

    return {
      player: { ...state.player, level },
      balance: state.balance,
      resources: state.resources,
      items: state.items,
      buildings: state.buildings,
      stake: state.stake,
      pendingYield: projection.produced,
    };
  }

  async getBalance(owner: Address): Promise<Raw> {
    await this.#delay(40, 100);
    return loadPlayer(owner)?.balance ?? 0n;
  }

  async getListings(query: ListingQuery = {}): Promise<ListingPage> {
    await this.#delay(80, 200);
    this.#advanceMarket();

    const {
      slot = "all",
      rarity = "all",
      minPrice,
      maxPrice,
      seller,
      search,
      sort = "recent",
      limit = 24,
      offset = 0,
    } = query;

    let rows = this.#global.listings.filter((l) => l.active);

    const floor = rows.length
      ? rows.reduce((min, l) => (l.price < min ? l.price : min), rows[0].price)
      : null;

    if (slot !== "all") rows = rows.filter((l) => l.item.slot === slot);
    if (rarity !== "all") rows = rows.filter((l) => l.item.rarity === rarity);
    if (minPrice !== undefined) rows = rows.filter((l) => l.price >= minPrice);
    if (maxPrice !== undefined) rows = rows.filter((l) => l.price <= maxPrice);
    if (seller) rows = rows.filter((l) => l.seller === seller);
    if (search) {
      const needle = search.trim().toLowerCase();
      rows = rows.filter((l) => {
        const archetype = ARCHETYPE_BY_KEY.get(l.item.archetype);
        return (
          archetype?.name.toLowerCase().includes(needle) ||
          l.item.rarity.includes(needle) ||
          l.item.slot.includes(needle)
        );
      });
    }

    switch (sort) {
      case "price-asc":
        rows.sort((a, b) => (a.price > b.price ? 1 : a.price < b.price ? -1 : 0));
        break;
      case "price-desc":
        rows.sort((a, b) => (b.price > a.price ? 1 : b.price < a.price ? -1 : 0));
        break;
      case "rarity":
        rows.sort(
          (a, b) =>
            RARITIES.indexOf(b.item.rarity) - RARITIES.indexOf(a.item.rarity) ||
            itemPower(b.item.stats, b.item.rarity) - itemPower(a.item.stats, a.item.rarity)
        );
        break;
      default:
        rows.sort((a, b) => b.createdAt - a.createdAt);
    }

    return {
      listings: rows.slice(offset, offset + limit),
      total: rows.length,
      floor,
    };
  }

  async getListing(id: ListingId): Promise<Listing | null> {
    await this.#delay(40, 100);
    return this.#global.listings.find((l) => l.id === id && l.active) ?? null;
  }

  async getOffers(listingId: ListingId): Promise<Offer[]> {
    await this.#delay(40, 100);
    const now = Date.now();
    return this.#global.offers
      .filter((o) => o.listingId === listingId && o.expiresAt > now)
      .sort((a, b) => (b.amount > a.amount ? 1 : -1));
  }

  async getRecentEvents(limit = 30): Promise<ChainEvent[]> {
    await this.#delay(30, 90);
    return this.#global.events.slice(0, limit);
  }

  async getLeaderboard(limit = 24): Promise<LeaderboardRow[]> {
    await this.#delay(70, 180);
    const rows = syntheticLeaderboard(limit);

    const address = this.#wallet.address;
    if (address) {
      const state = loadPlayer(address);
      if (state) {
        const { level } = levelFromXp(state.player.xp);
        const itemWorth = state.items.reduce(
          (n, i) => n + salvageValue(i.stats, i.rarity, i.quality),
          0
        );
        rows.push({
          rank: 0,
          address,
          displayName: "You",
          level,
          totalMined: state.player.totalMined,
          netWorth: state.balance + toRaw(itemWorth),
          synthetic: false,
        });
      }
    }

    return rerank(rows).slice(0, limit);
  }

  #advanceMarket(): void {
    const result = tickMarket(this.#global.listings, this.#global.lastMarketTick);
    if (!result.changed) return;
    this.#global.listings = result.listings;
    this.#global.lastMarketTick = Date.now();
    saveGlobal(this.#global);
  }

  /* ======================================================================
     Player lifecycle
     ====================================================================== */

  async initPlayer(): Promise<TxReceipt<PlayerSnapshot>> {
    const address = this.#requireAddress();
    await this.#delay(400, 900);

    const existing = loadPlayer(address);
    if (existing) return this.#receipt(this.#snapshotFrom(existing));

    const now = Date.now();
    const claimSeed = seedFromString(address);

    const player: PlayerAccount = {
      owner: address,
      claimSeed,
      createdAt: now,
      level: 1,
      xp: 0,
      lastSettledAt: now,
      totalMined: 0,
      packsOpened: 0,
    };

    // A starter pick, rolled from the claim seed so it is reproducible.
    const starterSeed = sha256(new TextEncoder().encode(`starter:${address}`));
    const archetype = ARCHETYPE_BY_KEY.get("field_pick")!;
    const rolled = rollItem(archetype, "common", starterSeed, 0);

    const state: MockPlayerState = {
      player,
      balance: toRaw(2_500),
      resources: { coal: 60, iron: 20 },
      items: [
        {
          id: asItemId(`itm_${base58Encode(randomBytes(12))}`),
          archetype: archetype.key,
          slot: archetype.slot,
          rarity: "common",
          stats: rolled.stats,
          quality: rolled.quality,
          mintedAt: now,
          sourceSignature: null,
          equipped: true,
          listed: false,
        },
      ],
      buildings: [],
      stake: null,
      commits: [],
      energy: { value: BASE.energyMax, at: now },
      yieldCarry: 0,
      nextNonce: 0,
    };

    savePlayer(address, state);
    const receipt = this.#receipt(this.#snapshotFrom(state), 2_039_280);
    this.#emit("yield_claimed", "Registered a new claim", receipt.signature);
    return receipt;
  }

  async claimYield(): Promise<TxReceipt<{ granted: ResourceBag }>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(320, 700);

    const city = deriveCityStats(state.buildings);
    const itemStats = aggregateItemStats(state.items);
    const { level } = levelFromXp(state.player.xp);
    const stats = derivePlayerStats(itemStats, city, level);

    const elapsed = Math.max(0, (Date.now() - state.player.lastSettledAt) / 1000);
    const result = simulateProduction({
      buildings: state.buildings,
      resources: state.resources,
      city,
      stats,
      elapsedSeconds: elapsed,
    });

    if (bagTotal(result.produced) === 0 && bagTotal(result.consumed) === 0) {
      throw new ChainError("Nothing has accrued yet", "invalid_state");
    }

    state.resources = bagMerge(state.resources, result.produced);
    for (const [kind, qty] of Object.entries(result.consumed) as [ResourceKind, number][]) {
      bagAdd(state.resources, kind, -(qty ?? 0));
    }
    for (const building of state.buildings) {
      const depth = result.boreDepths[building.id];
      if (depth !== undefined) building.boreDepth = depth;
    }
    state.player.lastSettledAt = Date.now();
    state.player.xp += Math.floor(bagTotal(result.produced) / 4);

    savePlayer(address, state);
    const receipt = this.#receipt({ granted: result.produced });
    this.#emit(
      "yield_claimed",
      `Settled ${bagTotal(result.produced).toLocaleString()} units of city output`,
      receipt.signature
    );
    return receipt;
  }

  async settleMining(
    bag: ResourceBag,
    energySpent: number
  ): Promise<TxReceipt<{ granted: ResourceBag }>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(200, 480);

    const city = deriveCityStats(state.buildings);
    const itemStats = aggregateItemStats(state.items);
    const { level } = levelFromXp(state.player.xp);
    const stats = derivePlayerStats(itemStats, city, level);

    const now = Date.now();
    const available = currentEnergy(state.energy.value, state.energy.at, stats, now);

    // --- the anti-cheat bound ------------------------------------------
    // Energy is a pure function of elapsed time, so the maximum that could
    // have been spent is knowable independently of anything the client says.
    if (energySpent > available + 0.5) {
      throw new ChainError(
        "Mining batch claims more energy than has accrued",
        "invalid_state",
        false
      );
    }

    // And yield is bounded by energy: even the softest block costs something.
    const cheapestBlockCost = miningEnergyCost(0.5, stats);
    const maxUnits = Math.ceil((energySpent / cheapestBlockCost) * miningYield(stats)) + 4;
    if (bagTotal(bag) > maxUnits) {
      throw new ChainError(
        "Mining batch claims more yield than the energy spent allows",
        "invalid_state",
        false
      );
    }

    const headroom = Math.max(0, city.storageCap - bagTotal(state.resources));
    const granted: ResourceBag = {};
    let remaining = headroom;
    for (const [kind, qty] of Object.entries(bag) as [ResourceKind, number][]) {
      const take = Math.min(qty ?? 0, remaining);
      if (take > 0) {
        bagAdd(granted, kind, take);
        remaining -= take;
      }
    }

    state.resources = bagMerge(state.resources, granted);
    state.energy = { value: Math.max(0, available - energySpent), at: now };
    state.player.totalMined += bagTotal(granted);
    state.player.xp += Math.max(1, Math.floor(bagTotal(granted) / 2));

    savePlayer(address, state);
    return this.#receipt({ granted });
  }

  async sellResources(bag: ResourceBag): Promise<TxReceipt<{ proceeds: Raw }>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(300, 640);

    if (bagTotal(bag) === 0) throw new ChainError("Nothing selected to sell", "invalid_state");
    if (!bagCovers(state.resources, bag)) {
      throw new ChainError("You don't have those resources", "insufficient_funds");
    }

    const proceeds = saleProceeds(bag);
    bagSubtract(state.resources, bag);
    state.balance += toRaw(proceeds);
    state.player.xp += Math.floor(proceeds / 12);

    savePlayer(address, state);
    const receipt = this.#receipt({ proceeds: toRaw(proceeds) });
    this.#emit(
      "resources_sold",
      `Sold ${bagTotal(bag).toLocaleString()} units for ${proceeds.toLocaleString()} STRATA`,
      receipt.signature,
      { amount: toRaw(proceeds) }
    );
    return receipt;
  }

  /**
   * Rushes a smelting batch.
   *
   * Smelters do this for free over time. Paying to skip the wait is the point
   * of this instruction — without the fee there'd be no reason to ever build a
   * Smelter, since instant free conversion would strictly dominate it.
   */
  async refine(input: ResourceBag): Promise<TxReceipt<{ produced: ResourceBag }>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(340, 700);

    const city = deriveCityStats(state.buildings);
    if (city.smelterCount === 0) {
      throw new ChainError("Build a Smelter before refining", "invalid_state");
    }
    const bestSmelter = Math.max(
      ...state.buildings.filter((b) => b.kind === "smelter").map((b) => b.level)
    );

    const produced: ResourceBag = {};
    const spent: ResourceBag = {};
    let outputValue = 0;

    for (const recipe of RECIPES) {
      const wanted = input[recipe.input] ?? 0;
      if (wanted <= 0) continue;
      if (recipe.minSmelterLevel > bestSmelter) {
        throw new ChainError(
          `${RESOURCE_DEFS[recipe.output].label} needs a level ${recipe.minSmelterLevel} Smelter`,
          "invalid_state"
        );
      }

      const available = Math.min(wanted, state.resources[recipe.input] ?? 0);
      const coalAvailable = (state.resources.coal ?? 0) - (spent.coal ?? 0);
      const batches = Math.min(
        Math.floor(available / recipe.inputQty),
        Math.floor(coalAvailable / recipe.coal)
      );
      if (batches <= 0) continue;

      bagAdd(produced, recipe.output, batches * recipe.outputQty);
      bagAdd(spent, recipe.input, batches * recipe.inputQty);
      bagAdd(spent, "coal", batches * recipe.coal);
      outputValue += RESOURCE_DEFS[recipe.output].baseValue * batches * recipe.outputQty;
    }

    if (bagTotal(produced) === 0) {
      throw new ChainError("Not enough input or coal to run a batch", "invalid_state");
    }

    const rushFee = toRaw(Math.ceil(outputValue * 0.08));
    if (state.balance < rushFee) {
      throw new ChainError(
        `Rush fee is ${toUi(rushFee).toLocaleString()} STRATA`,
        "insufficient_funds"
      );
    }

    bagSubtract(state.resources, spent);
    state.resources = bagMerge(state.resources, produced);
    state.balance -= rushFee;

    savePlayer(address, state);
    return this.#receipt({ produced });
  }

  /* ======================================================================
     City
     ====================================================================== */

  async placeBuilding(
    kind: BuildingKind,
    x: number,
    y: number,
    z: number,
    rotation: 0 | 1 | 2 | 3
  ): Promise<TxReceipt<PlacedBuilding>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(380, 820);

    const city = deriveCityStats(state.buildings);
    const { level } = levelFromXp(state.player.xp);

    const gate = canAfford(kind, city, level);
    if (!gate.ok) throw new ChainError(gate.reason, "invalid_state");

    const cost = buildingCost(kind, 1);
    if (state.balance < toRaw(cost.tokens)) {
      throw new ChainError(
        `Needs ${cost.tokens.toLocaleString()} STRATA`,
        "insufficient_funds"
      );
    }
    if (!bagCovers(state.resources, cost.resources)) {
      throw new ChainError("Missing construction materials", "insufficient_funds");
    }

    state.balance -= toRaw(cost.tokens);
    bagSubtract(state.resources, cost.resources);

    const building: PlacedBuilding = {
      id: `bld_${base58Encode(randomBytes(8))}`,
      kind,
      level: 1,
      x,
      y,
      z,
      rotation,
      placedAt: Date.now(),
      ...(kind === "extractor" ? { boreDepth: Math.min(y, SURFACE_Y) } : {}),
    };
    state.buildings.push(building);

    savePlayer(address, state);
    const receipt = this.#receipt(building);
    this.#emit("building_placed", `Placed a ${BUILDING_DEFS[kind].name}`, receipt.signature);
    return receipt;
  }

  async upgradeBuilding(id: string): Promise<TxReceipt<PlacedBuilding>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(340, 720);

    const building = state.buildings.find((b) => b.id === id);
    if (!building) throw new ChainError("Building not found", "not_found");

    const def = BUILDING_DEFS[building.kind];
    if (building.level >= def.maxLevel) {
      throw new ChainError(`${def.name} is already at max level`, "invalid_state");
    }

    const cost = buildingCost(building.kind, building.level + 1);
    if (state.balance < toRaw(cost.tokens)) {
      throw new ChainError(`Needs ${cost.tokens.toLocaleString()} STRATA`, "insufficient_funds");
    }
    if (!bagCovers(state.resources, cost.resources)) {
      throw new ChainError("Missing upgrade materials", "insufficient_funds");
    }

    state.balance -= toRaw(cost.tokens);
    bagSubtract(state.resources, cost.resources);
    building.level += 1;

    savePlayer(address, state);
    return this.#receipt(building);
  }

  async removeBuilding(id: string): Promise<TxReceipt<void>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(260, 560);

    const index = state.buildings.findIndex((b) => b.id === id);
    if (index < 0) throw new ChainError("Building not found", "not_found");

    const building = state.buildings[index];
    // Demolition returns 40% of the current level's cost. Enough that
    // rearranging a city isn't punishing, little enough that it isn't free.
    const cost = buildingCost(building.kind, building.level);
    state.balance += toRaw(Math.floor(cost.tokens * 0.4));
    state.buildings.splice(index, 1);

    savePlayer(address, state);
    return this.#receipt(undefined);
  }

  /* ======================================================================
     Equipment
     ====================================================================== */

  async equipItem(id: ItemId): Promise<TxReceipt<void>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(140, 340);

    const item = state.items.find((i) => i.id === id);
    if (!item) throw new ChainError("Item not found", "not_found");
    if (item.listed) throw new ChainError("Item is escrowed by a listing", "invalid_state");

    for (const other of state.items) {
      if (other.slot === item.slot) other.equipped = false;
    }
    item.equipped = true;

    savePlayer(address, state);
    return this.#receipt(undefined);
  }

  async unequipItem(id: ItemId): Promise<TxReceipt<void>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(140, 340);

    const item = state.items.find((i) => i.id === id);
    if (!item) throw new ChainError("Item not found", "not_found");
    item.equipped = false;

    savePlayer(address, state);
    return this.#receipt(undefined);
  }

  async salvageItem(id: ItemId): Promise<TxReceipt<{ proceeds: Raw }>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(260, 560);

    const index = state.items.findIndex((i) => i.id === id);
    if (index < 0) throw new ChainError("Item not found", "not_found");

    const item = state.items[index];
    if (item.listed) throw new ChainError("Cancel the listing first", "invalid_state");

    const proceeds = salvageValue(item.stats, item.rarity, item.quality);
    state.items.splice(index, 1);
    state.balance += toRaw(proceeds);

    savePlayer(address, state);
    return this.#receipt({ proceeds: toRaw(proceeds) });
  }

  /* ======================================================================
     Packs — commit / reveal

     The two-step flow is the whole reason packs are trustworthy. Step one
     locks in a secret nobody can see; step two mixes it with entropy that did
     not exist when the secret was chosen. Neither party can steer the result.
     ====================================================================== */

  async commitPack(kind: PackKind): Promise<TxReceipt<PackCommit>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(320, 700);

    const price = toRaw(PACK_DEFS[kind].priceTokens);
    if (state.balance < price) {
      throw new ChainError(
        `${PACK_DEFS[kind].name} costs ${PACK_DEFS[kind].priceTokens.toLocaleString()} STRATA`,
        "insufficient_funds"
      );
    }

    const clientSeed = randomBytes(32);
    const clientSeedHash = sha256(clientSeed);
    const nonce = state.nextNonce++;
    const slot = this.#slot();

    const commit: StoredCommit = {
      id: `cmt_${base58Encode(randomBytes(10))}`,
      owner: address,
      kind,
      nonce,
      clientSeedHex: bytesToHex(clientSeed),
      clientSeedHashHex: bytesToHex(clientSeedHash),
      committedSlot: slot,
      committedAt: Date.now(),
      revealed: false,
      revealSignature: null,
    };

    state.balance -= price;
    state.commits.push(commit);
    savePlayer(address, state);

    return this.#receipt(toPublicCommit(commit));
  }

  async revealPack(commitId: string): Promise<TxReceipt<PackReveal>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(420, 900);

    const commit = state.commits.find((c) => c.id === commitId);
    if (!commit) throw new ChainError("Commit not found", "not_found");
    if (commit.revealed) throw new ChainError("Already revealed", "invalid_state");

    const clientSeed = hexToBytes(commit.clientSeedHex);

    // Verify the commitment, exactly as the program will.
    const recomputed = bytesToHex(sha256(clientSeed));
    if (recomputed !== commit.clientSeedHashHex) {
      throw new ChainError("Commitment does not match the revealed seed", "invalid_state", false);
    }

    // Entropy that did not exist when the commit was made. On Solana this is
    // read from the SlotHashes sysvar; here it is derived from the slot number
    // so the reveal is still reproducible by anyone holding both transactions.
    const slotHash = sha256(new TextEncoder().encode(`slot:${commit.committedSlot + 1}`));

    const revealSeed = sha256(
      concatBytes(
        clientSeed,
        slotHash,
        new TextEncoder().encode(address),
        new Uint8Array(new Uint32Array([commit.nonce]).buffer)
      )
    );

    const city = deriveCityStats(state.buildings);
    const itemStats = aggregateItemStats(state.items);
    const { level } = levelFromXp(state.player.xp);
    const stats = derivePlayerStats(itemStats, city, level);

    const outcome = openPack(commit.kind, revealSeed, stats.luck);
    const signature = this.#signature();

    const items: ItemInstance[] = outcome.items.map((rolled, i) => ({
      id: asItemId(`itm_${base58Encode(randomBytes(12))}`),
      archetype: rolled.archetype.key,
      slot: rolled.archetype.slot,
      rarity: rolled.rarity,
      stats: rolled.stats,
      quality: rolled.quality,
      mintedAt: Date.now() + i,
      sourceSignature: asSignature(signature),
      equipped: false,
      listed: false,
    }));

    state.items.push(...items);
    state.resources = bagMerge(state.resources, outcome.resources);
    if (outcome.bonusTokens > 0) state.balance += toRaw(outcome.bonusTokens);
    state.player.packsOpened += 1;
    state.player.xp += 40;
    commit.revealed = true;
    commit.revealSignature = signature;

    savePlayer(address, state);

    const best = items.reduce(
      (top, i) => (RARITIES.indexOf(i.rarity) > RARITIES.indexOf(top) ? i.rarity : top),
      "common" as (typeof RARITIES)[number]
    );

    const reveal: PackReveal = {
      commitId: commit.id as PackReveal["commitId"],
      revealSeed: bytesToHex(revealSeed),
      clientSeed: commit.clientSeedHex,
      slotHash: bytesToHex(slotHash),
      dropTableVersion: DROP_TABLE_VERSION,
      reward: {
        items,
        resources: outcome.resources,
        tokens: toRaw(outcome.bonusTokens),
      },
    };

    const receipt: TxReceipt<PackReveal> = {
      ...this.#receipt(reveal),
      signature: asSignature(signature),
    };
    this.#emit(
      "pack_opened",
      `Opened a ${PACK_DEFS[commit.kind].name} — pulled ${best}`,
      signature,
      { rarity: best }
    );
    return receipt;
  }

  async getPendingCommits(owner: Address): Promise<PackCommit[]> {
    await this.#delay(30, 80);
    const state = loadPlayer(owner);
    if (!state) return [];
    return state.commits.filter((c) => !c.revealed).map(toPublicCommit);
  }

  /* ======================================================================
     Marketplace
     ====================================================================== */

  async listItem(id: ItemId, price: Raw): Promise<TxReceipt<Listing>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(340, 740);

    const city = deriveCityStats(state.buildings);
    if (!city.hasMarket) {
      throw new ChainError("Build a Market Hub to list items", "invalid_state");
    }
    if (price <= 0n) throw new ChainError("Price must be above zero", "invalid_state");

    const item = state.items.find((i) => i.id === id);
    if (!item) throw new ChainError("Item not found", "not_found");
    if (item.listed) throw new ChainError("Already listed", "invalid_state");

    // Escrow: the item leaves the player's usable inventory while listed.
    item.listed = true;
    item.equipped = false;

    const listing: Listing = {
      id: asListingId(`lst_${base58Encode(randomBytes(10))}`),
      seller: address,
      item: { ...item },
      price,
      createdAt: Date.now(),
      expiresAt: null,
      active: true,
      synthetic: false,
    };

    this.#global.listings.unshift(listing);
    saveGlobal(this.#global);
    savePlayer(address, state);

    const receipt = this.#receipt(listing);
    this.#emit(
      "listing_created",
      `Listed ${ARCHETYPE_BY_KEY.get(item.archetype)?.name ?? "an item"} for ${toUi(price).toLocaleString()} STRATA`,
      receipt.signature,
      { rarity: item.rarity, amount: price }
    );
    return receipt;
  }

  async cancelListing(id: ListingId): Promise<TxReceipt<void>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(240, 520);

    const index = this.#global.listings.findIndex((l) => l.id === id);
    if (index < 0) throw new ChainError("Listing not found", "not_found");

    const listing = this.#global.listings[index];
    if (listing.seller !== address) throw new ChainError("Not your listing", "rejected");

    this.#global.listings.splice(index, 1);
    saveGlobal(this.#global);

    const item = state.items.find((i) => i.id === listing.item.id);
    if (item) item.listed = false;
    savePlayer(address, state);

    const receipt = this.#receipt(undefined);
    this.#emit("listing_cancelled", "Cancelled a listing", receipt.signature);
    return receipt;
  }

  async buyListing(id: ListingId): Promise<TxReceipt<{ paid: Raw; fee: Raw }>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(420, 880);

    const index = this.#global.listings.findIndex((l) => l.id === id && l.active);
    if (index < 0) throw new ChainError("Listing is no longer available", "not_found");

    const listing = this.#global.listings[index];
    if (listing.seller === address) throw new ChainError("That's your own listing", "rejected");
    if (state.balance < listing.price) {
      throw new ChainError("Not enough STRATA for this listing", "insufficient_funds");
    }

    const config = await this.getConfig();
    const city = deriveCityStats(state.buildings);
    const split = marketFeeSplit(
      Math.floor(toUi(listing.price)),
      city.marketFeeBps,
      config.burnShareBps
    );

    state.balance -= listing.price;
    state.items.push({
      ...listing.item,
      id: asItemId(`itm_${base58Encode(randomBytes(12))}`),
      listed: false,
      equipped: false,
    });

    // A real seller is credited; a synthetic one is a currency sink.
    if (!listing.synthetic) {
      const sellerState = loadPlayer(listing.seller);
      if (sellerState) {
        sellerState.balance += toRaw(split.toSeller);
        sellerState.items = sellerState.items.filter((i) => i.id !== listing.item.id);
        savePlayer(listing.seller, sellerState);
      }
    }

    this.#global.listings.splice(index, 1);
    saveGlobal(this.#global);
    savePlayer(address, state);

    const receipt = this.#receipt({ paid: listing.price, fee: toRaw(split.fee) });
    this.#emit(
      "listing_sold",
      `${ARCHETYPE_BY_KEY.get(listing.item.archetype)?.name ?? "An item"} sold for ${toUi(listing.price).toLocaleString()} STRATA`,
      receipt.signature,
      { rarity: listing.item.rarity, amount: listing.price }
    );
    return receipt;
  }

  async makeOffer(id: ListingId, amount: Raw, ttlSeconds: number): Promise<TxReceipt<Offer>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(280, 620);

    const listing = this.#global.listings.find((l) => l.id === id && l.active);
    if (!listing) throw new ChainError("Listing not found", "not_found");
    if (amount <= 0n) throw new ChainError("Offer must be above zero", "invalid_state");
    if (state.balance < amount) {
      throw new ChainError("Offer exceeds your balance", "insufficient_funds");
    }

    const offer: Offer = {
      id: `ofr_${base58Encode(randomBytes(8))}`,
      listingId: id,
      buyer: address,
      amount,
      expiresAt: Date.now() + ttlSeconds * 1000,
      createdAt: Date.now(),
    };

    this.#global.offers.push(offer);
    saveGlobal(this.#global);

    const receipt = this.#receipt(offer);
    this.#emit(
      "offer_made",
      `Offered ${toUi(amount).toLocaleString()} STRATA`,
      receipt.signature,
      { amount }
    );
    return receipt;
  }

  async acceptOffer(offerId: string): Promise<TxReceipt<{ proceeds: Raw }>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(400, 860);

    const offerIndex = this.#global.offers.findIndex((o) => o.id === offerId);
    if (offerIndex < 0) throw new ChainError("Offer not found", "not_found");

    const offer = this.#global.offers[offerIndex];
    if (offer.expiresAt < Date.now()) throw new ChainError("Offer has expired", "invalid_state");

    const listingIndex = this.#global.listings.findIndex((l) => l.id === offer.listingId);
    if (listingIndex < 0) throw new ChainError("Listing no longer exists", "not_found");

    const listing = this.#global.listings[listingIndex];
    if (listing.seller !== address) throw new ChainError("Not your listing", "rejected");

    const config = await this.getConfig();
    const city = deriveCityStats(state.buildings);
    const split = marketFeeSplit(
      Math.floor(toUi(offer.amount)),
      city.marketFeeBps,
      config.burnShareBps
    );

    state.balance += toRaw(split.toSeller);
    state.items = state.items.filter((i) => i.id !== listing.item.id);

    this.#global.listings.splice(listingIndex, 1);
    this.#global.offers.splice(offerIndex, 1);
    saveGlobal(this.#global);
    savePlayer(address, state);

    const receipt = this.#receipt({ proceeds: toRaw(split.toSeller) });
    this.#emit(
      "listing_sold",
      `Accepted an offer for ${toUi(offer.amount).toLocaleString()} STRATA`,
      receipt.signature,
      { amount: offer.amount }
    );
    return receipt;
  }

  /* ======================================================================
     Staking
     ====================================================================== */

  async stake(amount: Raw, lockDays: number): Promise<TxReceipt<StakePosition>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(340, 720);

    if (amount <= 0n) throw new ChainError("Stake must be above zero", "invalid_state");
    if (state.balance < amount) throw new ChainError("Not enough STRATA", "insufficient_funds");
    if (state.stake) throw new ChainError("Unstake your current position first", "invalid_state");

    const days = Math.max(1, Math.min(180, Math.floor(lockDays)));
    // 10 bps per day locked, capped at 1800 bps (18%).
    const boostBps = Math.min(1_800, days * 10);

    const position: StakePosition = {
      owner: address,
      amount,
      lockedUntil: Date.now() + days * 86_400_000,
      boostBps,
      startedAt: Date.now(),
    };

    state.balance -= amount;
    state.stake = position;
    savePlayer(address, state);

    const receipt = this.#receipt(position);
    this.#emit(
      "staked",
      `Locked ${toUi(amount).toLocaleString()} STRATA for ${days} days`,
      receipt.signature,
      { amount }
    );
    return receipt;
  }

  async unstake(): Promise<TxReceipt<{ returned: Raw }>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(300, 640);

    if (!state.stake) throw new ChainError("Nothing staked", "not_found");

    const position = state.stake;
    const early = Date.now() < position.lockedUntil;
    // Early exit forfeits 10%. Stated up front in the UI, not a surprise.
    const returned = early ? (position.amount * 90n) / 100n : position.amount;

    state.balance += returned;
    state.stake = null;
    savePlayer(address, state);

    return this.#receipt({ returned });
  }

  /* ======================================================================
     Dev affordances
     ====================================================================== */

  /** Wipes the simulated claim. Surfaced in the UI as "Reset claim". */
  reset(): void {
    const address = this.#wallet.address;
    resetAll(address ?? undefined);
    removeKey(KEYS.global);
    this.#global = loadGlobal();
    this.#global.listings = seedMarket();
    this.#global.syntheticSeeded = true;
    this.#global.lastMarketTick = Date.now();
    saveGlobal(this.#global);
  }

  /** Grants currency. Only reachable in mock mode; there is nothing to inflate. */
  async faucet(amountTokens: number): Promise<TxReceipt<{ balance: Raw }>> {
    const { address, state } = this.#requirePlayer();
    await this.#delay(200, 420);
    state.balance += toRaw(amountTokens);
    savePlayer(address, state);
    return this.#receipt({ balance: state.balance });
  }
}

function toPublicCommit(commit: StoredCommit): PackCommit {
  // The client secret is deliberately not part of the public shape — it stays
  // on the player's device until the reveal transaction.
  return {
    id: commit.id as PackCommit["id"],
    owner: commit.owner,
    kind: commit.kind,
    nonce: commit.nonce,
    clientSeedHash: commit.clientSeedHashHex,
    committedSlot: commit.committedSlot,
    committedAt: commit.committedAt,
    revealed: commit.revealed,
  };
}

const DEMO_WALLET_ICON =
  "data:image/svg+xml;base64," +
  btoaSafe(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <rect width="32" height="32" fill="#10151f"/>
      <path d="M16 5l9 5.2v10.6L16 26l-9-5.2V10.2z" fill="#ff9a2e"/>
      <path d="M16 5l9 5.2L16 15.6 7 10.2z" fill="#ffb75c"/>
      <path d="M16 15.6V26l-9-5.2V10.2z" fill="#c46a11"/>
    </svg>`
  );

/** btoa isn't defined during SSR; the icon is only ever read in the browser. */
function btoaSafe(input: string): string {
  if (typeof btoa === "function") return btoa(input);
  return Buffer.from(input, "utf-8").toString("base64");
}

export { Rng };
