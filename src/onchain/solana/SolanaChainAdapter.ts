import { createSolanaRpc, type Address as KitAddress } from "@solana/kit";
import { sha256 } from "@/lib/rng";
import type { BuildingKind, PackKind, ResourceBag } from "@/sim/types";
import type { ChainAdapter, LeaderboardRow } from "../adapter";
import {
  ChainError,
  asAddress,
  type Address,
  type ChainEvent,
  type GameConfig,
  type ItemId,
  type Listing,
  type ListingId,
  type ListingPage,
  type ListingQuery,
  type Offer,
  type PackCommit,
  type PackReveal,
  type PlacedBuilding,
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
  onAccountChanged,
  onWalletsChanged,
} from "../wallet/standard";
import {
  commitPda,
  configPda,
  encodeBuyListing,
  encodeCommitPack,
  encodeInitPlayer,
  explorerUrl,
  listingPda,
  playerPda,
  programId,
  SLOT_HASHES_SYSVAR,
  SYSTEM_PROGRAM,
  vaultPda,
} from "./program";

/**
 * The real chain adapter.
 *
 * Deliberately not a stub full of `TODO`. Wallet connection, RPC, PDA
 * derivation and instruction encoding are all live and testable right now —
 * the only thing that doesn't exist yet is a deployed program to send to, so
 * writes assemble a correct instruction and then stop at `#send`.
 *
 * That split is intentional. It means the expensive, error-prone half of the
 * integration (account ordering, seeds, byte layouts) can be verified against
 * a localnet the day the programs compile, rather than being written in a rush
 * on deploy day.
 *
 * To go live:
 *   1. `anchor deploy` the three programs in `programs/`
 *   2. set NEXT_PUBLIC_PROGRAM_ID and NEXT_PUBLIC_CHAIN_MODE=devnet
 *   3. implement `#send` with the wallet's `solana:signAndSendTransaction`
 *   4. fill in the account decoders in `#decodePlayer`
 *
 * See docs/ONCHAIN.md for the full checklist.
 */
export class SolanaChainAdapter implements ChainAdapter {
  readonly kind = "solana" as const;
  readonly cluster: string;
  readonly label: string;

  #rpc: ReturnType<typeof createSolanaRpc>;
  #wallet: WalletState = { status: "disconnected", address: null, walletName: null };
  #listeners = new Set<(state: WalletState) => void>();
  #unsubs: Array<() => void> = [];

  constructor(cluster: "devnet" | "mainnet-beta", endpoint?: string) {
    this.cluster = cluster;
    this.label = cluster === "devnet" ? "Devnet" : "Mainnet";
    this.#rpc = createSolanaRpc(
      endpoint ??
        process.env.NEXT_PUBLIC_RPC_URL ??
        `https://api.${cluster === "mainnet-beta" ? "mainnet-beta" : "devnet"}.solana.com`
    );

    if (typeof window !== "undefined") {
      this.#unsubs.push(onWalletsChanged(() => this.#notify()));
    }
  }

  dispose(): void {
    for (const unsub of this.#unsubs) unsub();
    this.#unsubs = [];
    this.#listeners.clear();
  }

  /* ======================================================================
     Wallet — fully working today
     ====================================================================== */

  getWalletState(): WalletState {
    return this.#wallet;
  }

  listWallets(): WalletInfo[] {
    return discoverWallets().map((w) => ({ name: w.name, icon: w.icon, installed: true }));
  }

  async connect(walletName?: string): Promise<WalletState> {
    const wallets = discoverWallets();
    const target = walletName ? wallets.find((w) => w.name === walletName) : wallets[0];
    if (!target) {
      throw new ChainError(
        walletName ? `${walletName} is not installed` : "No Solana wallet detected",
        "not_connected"
      );
    }

    this.#setWallet({ status: "connecting", address: null, walletName: target.name });

    try {
      const address = await connectWallet(target.wallet);
      if (!address) throw new ChainError("Wallet returned no account", "rejected");

      this.#unsubs.push(
        onAccountChanged(target.wallet, (next) => {
          this.#setWallet(
            next
              ? { status: "connected", address: asAddress(next), walletName: target.name }
              : { status: "disconnected", address: null, walletName: null }
          );
        })
      );

      return this.#setWallet({
        status: "connected",
        address: asAddress(address),
        walletName: target.name,
      });
    } catch (error) {
      this.#setWallet({ status: "disconnected", address: null, walletName: null });
      throw error instanceof ChainError
        ? error
        : new ChainError(
            error instanceof Error ? error.message : "Connection rejected",
            "rejected"
          );
    }
  }

  async disconnect(): Promise<void> {
    const name = this.#wallet.walletName;
    const found = name ? discoverWallets().find((w) => w.name === name) : undefined;
    if (found) await disconnectWallet(found.wallet).catch(() => {});
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

  #requireAddress(): KitAddress {
    if (this.#wallet.status !== "connected" || !this.#wallet.address) {
      throw new ChainError("Connect a wallet first", "not_connected");
    }
    return this.#wallet.address as unknown as KitAddress;
  }

  /* ======================================================================
     Reads
     ====================================================================== */

  async getConfig(): Promise<GameConfig> {
    const [config] = await configPda();
    const account = await this.#rpc
      .getAccountInfo(config, { encoding: "base64" })
      .send()
      .catch(() => null);

    if (!account?.value) {
      throw new ChainError(
        `Game config not found at ${config}. Deploy the programs and run initialize_config.`,
        "not_found",
        false
      );
    }

    // Decoding lands here once the account layout is frozen; the borsh reader
    // in ./borsh.ts already covers every field type the account uses.
    throw this.#notDeployed("getConfig");
  }

  /**
   * Native SOL balance — genuinely live, and useful before the token exists:
   * it proves the RPC endpoint, the wallet connection and the address are all
   * wired correctly without needing a single deployed program.
   */
  async getSolBalance(owner: Address): Promise<bigint> {
    const result = await this.#rpc.getBalance(owner as unknown as KitAddress).send();
    return BigInt(result.value);
  }

  async getBalance(owner: Address): Promise<Raw> {
    const mint = process.env.NEXT_PUBLIC_TOKEN_MINT;
    if (!mint) {
      throw new ChainError(
        "No token mint configured. STRATA has not launched a token yet.",
        "not_found",
        false
      );
    }

    const accounts = await this.#rpc
      .getTokenAccountsByOwner(
        owner as unknown as KitAddress,
        { mint: mint as KitAddress },
        { encoding: "jsonParsed" }
      )
      .send();

    let total = 0n;
    for (const { account } of accounts.value) {
      const parsed = account.data as unknown as {
        parsed?: { info?: { tokenAmount?: { amount?: string } } };
      };
      const amount = parsed.parsed?.info?.tokenAmount?.amount;
      if (amount) total += BigInt(amount);
    }
    return total;
  }

  async getSnapshot(owner: Address): Promise<PlayerSnapshot | null> {
    const [player] = await playerPda(owner as unknown as KitAddress);
    const account = await this.#rpc
      .getAccountInfo(player, { encoding: "base64" })
      .send()
      .catch(() => null);

    if (!account?.value) return null; // No claim registered — a valid answer.
    throw this.#notDeployed("getSnapshot");
  }

  async getListings(_query?: ListingQuery): Promise<ListingPage> {
    // On-chain this is a `getProgramAccounts` call filtered by the Listing
    // discriminator, then cached. In production it should be served by the
    // indexer in `services/indexer` rather than hitting RPC from the browser.
    throw this.#notDeployed("getListings");
  }

  async getListing(_id: ListingId): Promise<Listing | null> {
    throw this.#notDeployed("getListing");
  }

  async getOffers(_listingId: ListingId): Promise<Offer[]> {
    throw this.#notDeployed("getOffers");
  }

  async getRecentEvents(_limit?: number): Promise<ChainEvent[]> {
    // Sourced from program logs via the indexer's websocket subscription.
    throw this.#notDeployed("getRecentEvents");
  }

  async getLeaderboard(_limit?: number): Promise<LeaderboardRow[]> {
    throw this.#notDeployed("getLeaderboard");
  }

  /* ======================================================================
     Writes

     The three below are built end to end — correct programs, correct account
     ordering, correct data — and stop only at the send. The rest follow the
     identical pattern and are filled in alongside their Rust handlers.
     ====================================================================== */

  async initPlayer(): Promise<TxReceipt<PlayerSnapshot>> {
    const owner = this.#requireAddress();
    const [config] = await configPda();
    const [player] = await playerPda(owner);

    const instruction = {
      programAddress: programId(),
      accounts: [
        { address: player, role: 1 /* writable */ },
        { address: config, role: 0 /* readonly */ },
        { address: owner, role: 3 /* writable signer */ },
        { address: SYSTEM_PROGRAM, role: 0 },
      ],
      data: encodeInitPlayer(),
    };

    return this.#send(instruction, "initPlayer");
  }

  async commitPack(kind: PackKind): Promise<TxReceipt<PackCommit>> {
    const owner = this.#requireAddress();
    const nonce = await this.#nextNonce(owner);

    // The secret never leaves the device until reveal — only its hash is sent.
    const clientSeed = crypto.getRandomValues(new Uint8Array(32));
    const clientSeedHash = sha256(clientSeed);
    this.#stashSeed(nonce, clientSeed);

    const [config] = await configPda();
    const [player] = await playerPda(owner);
    const [commit] = await commitPda(owner, nonce);

    const instruction = {
      programAddress: programId(),
      accounts: [
        { address: commit, role: 1 },
        { address: player, role: 1 },
        { address: config, role: 0 },
        { address: owner, role: 3 },
        { address: SYSTEM_PROGRAM, role: 0 },
      ],
      data: encodeCommitPack(kind, clientSeedHash),
    };

    return this.#send(instruction, "commitPack");
  }

  async buyListing(id: ListingId): Promise<TxReceipt<{ paid: Raw; fee: Raw }>> {
    const buyer = this.#requireAddress();
    const listing = await this.getListing(id);
    if (!listing) throw new ChainError("Listing not found", "not_found");

    const [config] = await configPda();
    const [listingAddress] = await listingPda(
      listing.seller as unknown as KitAddress,
      listing.item.id as unknown as KitAddress
    );
    const [vault] = await vaultPda(listingAddress);

    const instruction = {
      programAddress: programId(),
      accounts: [
        { address: listingAddress, role: 1 },
        { address: vault, role: 1 },
        { address: config, role: 0 },
        { address: listing.seller as unknown as KitAddress, role: 1 },
        { address: buyer, role: 3 },
        { address: SYSTEM_PROGRAM, role: 0 },
      ],
      // Passing the accepted price makes a mid-flight price change fail loudly
      // rather than quietly charging more than the buyer agreed to.
      data: encodeBuyListing(listing.price),
    };

    return this.#send(instruction, "buyListing");
  }

  async revealPack(_commitId: string): Promise<TxReceipt<PackReveal>> {
    // Reads the SlotHashes sysvar for entropy that did not exist at commit.
    void SLOT_HASHES_SYSVAR;
    throw this.#notDeployed("revealPack");
  }

  async claimYield(): Promise<TxReceipt<{ granted: ResourceBag }>> {
    throw this.#notDeployed("claimYield");
  }

  async settleMining(
    _bag: ResourceBag,
    _energySpent: number
  ): Promise<TxReceipt<{ granted: ResourceBag }>> {
    throw this.#notDeployed("settleMining");
  }

  async sellResources(_bag: ResourceBag): Promise<TxReceipt<{ proceeds: Raw }>> {
    throw this.#notDeployed("sellResources");
  }

  async refine(_input: ResourceBag): Promise<TxReceipt<{ produced: ResourceBag }>> {
    throw this.#notDeployed("refine");
  }

  async placeBuilding(
    _kind: BuildingKind,
    _x: number,
    _y: number,
    _z: number,
    _rotation: 0 | 1 | 2 | 3
  ): Promise<TxReceipt<PlacedBuilding>> {
    throw this.#notDeployed("placeBuilding");
  }

  async upgradeBuilding(_id: string): Promise<TxReceipt<PlacedBuilding>> {
    throw this.#notDeployed("upgradeBuilding");
  }

  async removeBuilding(_id: string): Promise<TxReceipt<void>> {
    throw this.#notDeployed("removeBuilding");
  }

  async equipItem(_id: ItemId): Promise<TxReceipt<void>> {
    throw this.#notDeployed("equipItem");
  }

  async unequipItem(_id: ItemId): Promise<TxReceipt<void>> {
    throw this.#notDeployed("unequipItem");
  }

  async salvageItem(_id: ItemId): Promise<TxReceipt<{ proceeds: Raw }>> {
    throw this.#notDeployed("salvageItem");
  }

  async getPendingCommits(_owner: Address): Promise<PackCommit[]> {
    throw this.#notDeployed("getPendingCommits");
  }

  async listItem(_id: ItemId, _price: Raw): Promise<TxReceipt<Listing>> {
    throw this.#notDeployed("listItem");
  }

  async cancelListing(_id: ListingId): Promise<TxReceipt<void>> {
    throw this.#notDeployed("cancelListing");
  }

  async makeOffer(_id: ListingId, _amount: Raw, _ttl: number): Promise<TxReceipt<Offer>> {
    throw this.#notDeployed("makeOffer");
  }

  async acceptOffer(_offerId: string): Promise<TxReceipt<{ proceeds: Raw }>> {
    throw this.#notDeployed("acceptOffer");
  }

  async stake(_amount: Raw, _lockDays: number): Promise<TxReceipt<StakePosition>> {
    throw this.#notDeployed("stake");
  }

  async unstake(): Promise<TxReceipt<{ returned: Raw }>> {
    throw this.#notDeployed("unstake");
  }

  /* ======================================================================
     Internals
     ====================================================================== */

  #notDeployed(operation: string): ChainError {
    return new ChainError(
      `${operation} needs the STRATA programs on ${this.cluster}, which are not deployed yet. ` +
        `Switch NEXT_PUBLIC_CHAIN_MODE back to "mock" to keep playing.`,
      "network",
      false
    );
  }

  /**
   * Signs and sends. Left unimplemented on purpose rather than guessed at —
   * the wallet feature to use (`solana:signAndSendTransaction` vs
   * `solana:signTransaction` plus our own send) depends on whether we want
   * priority-fee control, and that is a decision for deploy day.
   */
  async #send<T>(
    _instruction: { programAddress: KitAddress; accounts: unknown[]; data: Uint8Array },
    operation: string
  ): Promise<TxReceipt<T>> {
    throw this.#notDeployed(operation);
  }

  async #nextNonce(_owner: KitAddress): Promise<number> {
    // Read from the Player account once decoding lands. Until then this is
    // only reached by code paths that throw before using it.
    return 0;
  }

  #stashSeed(nonce: number, seed: Uint8Array): void {
    if (typeof window === "undefined") return;
    // The reveal is a second transaction, possibly after a reload, so the
    // secret has to outlive this call. Losing it means losing the pack.
    window.localStorage.setItem(
      `strata:commit-seed:${nonce}`,
      Array.from(seed)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  explorer(signature: string): string {
    return explorerUrl(signature, this.cluster);
  }
}
