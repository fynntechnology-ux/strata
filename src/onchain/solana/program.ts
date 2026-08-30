import { getAddressEncoder, getProgramDerivedAddress, type Address as KitAddress } from "@solana/kit";
import { sha256 } from "@noble/hashes/sha2.js";
import { BorshWriter } from "./borsh";
import { RESOURCE_U8, type BuildingKind, type PackKind, type ResourceBag, type ResourceKind } from "@/sim/types";
import { BUILDING_U8, PACK_U8 } from "@/sim/types";

/**
 * The client half of STRATA's Anchor programs.
 *
 * Everything here is real: the discriminator derivation, the PDA seeds and the
 * Borsh layouts all match `programs/` byte for byte. The only thing missing is
 * a deployed program id, which is why `SolanaChainAdapter` can build a
 * correct transaction today and simply has nowhere to send it.
 *
 * Keeping this file honest is what makes the eventual switch a configuration
 * change instead of a rewrite — and it means the layouts can be unit-tested
 * against the Rust side before anything is deployed.
 */

/* ==========================================================================
   Program ids
   ========================================================================== */

/**
 * Placeholder. Replaced by the real id at deploy time via
 * NEXT_PUBLIC_PROGRAM_ID. `resolveChainMode()` refuses to leave mock mode
 * until this is set, so a half-configured build can't silently target nothing.
 */
export const PROGRAM_ID_PLACEHOLDER = "Strata111111111111111111111111111111111111";

export function programId(): KitAddress {
  const configured = process.env.NEXT_PUBLIC_PROGRAM_ID?.trim();
  return (configured || PROGRAM_ID_PLACEHOLDER) as KitAddress;
}

export const SYSTEM_PROGRAM = "11111111111111111111111111111111" as KitAddress;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as KitAddress;
export const SLOT_HASHES_SYSVAR = "SysvarS1otHashes111111111111111111111111111" as KitAddress;

/* ==========================================================================
   Discriminators

   Anchor prefixes every instruction with the first 8 bytes of
   sha256("global:<snake_case_name>"), and every account with the first 8 bytes
   of sha256("account:<PascalCaseName>"). Deriving them rather than hardcoding
   means renaming an instruction in Rust surfaces as a failing test here.
   ========================================================================== */

export function instructionDiscriminator(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`global:${name}`)).subarray(0, 8);
}

export function accountDiscriminator(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`account:${name}`)).subarray(0, 8);
}

export const IX = {
  initializeConfig: "initialize_config",
  initPlayer: "init_player",
  claimYield: "claim_yield",
  settleMining: "settle_mining",
  sellResources: "sell_resources",
  refine: "refine",
  placeBuilding: "place_building",
  upgradeBuilding: "upgrade_building",
  removeBuilding: "remove_building",
  equipItem: "equip_item",
  salvageItem: "salvage_item",
  commitPack: "commit_pack",
  revealPack: "reveal_pack",
  listItem: "list_item",
  cancelListing: "cancel_listing",
  buyListing: "buy_listing",
  makeOffer: "make_offer",
  acceptOffer: "accept_offer",
  stake: "stake",
  unstake: "unstake",
} as const;

/* ==========================================================================
   PDAs

   Seeds are the schema. Changing one changes every derived address, so they
   live in exactly this one place and both the Rust `seeds = [...]` constraints
   and these helpers are checked against each other in tests.
   ========================================================================== */

const addressEncoder = getAddressEncoder();

function seed(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function pubkeyBytes(address: KitAddress): Uint8Array {
  return new Uint8Array(addressEncoder.encode(address));
}

function u32le(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return buf;
}

/** PDA: ["config"] */
export async function configPda(): Promise<readonly [KitAddress, number]> {
  return getProgramDerivedAddress({ programAddress: programId(), seeds: [seed("config")] });
}

/** PDA: ["player", owner] */
export async function playerPda(owner: KitAddress): Promise<readonly [KitAddress, number]> {
  return getProgramDerivedAddress({
    programAddress: programId(),
    seeds: [seed("player"), pubkeyBytes(owner)],
  });
}

/** PDA: ["commit", owner, nonce_le] */
export async function commitPda(owner: KitAddress, nonce: number): Promise<readonly [KitAddress, number]> {
  return getProgramDerivedAddress({
    programAddress: programId(),
    seeds: [seed("commit"), pubkeyBytes(owner), u32le(nonce)],
  });
}

/** PDA: ["listing", seller, item_mint] */
export async function listingPda(
  seller: KitAddress,
  itemMint: KitAddress
): Promise<readonly [KitAddress, number]> {
  return getProgramDerivedAddress({
    programAddress: programId(),
    seeds: [seed("listing"), pubkeyBytes(seller), pubkeyBytes(itemMint)],
  });
}

/** PDA: ["offer", listing, buyer] */
export async function offerPda(
  listing: KitAddress,
  buyer: KitAddress
): Promise<readonly [KitAddress, number]> {
  return getProgramDerivedAddress({
    programAddress: programId(),
    seeds: [seed("offer"), pubkeyBytes(listing), pubkeyBytes(buyer)],
  });
}

/** PDA: ["stake", owner] */
export async function stakePda(owner: KitAddress): Promise<readonly [KitAddress, number]> {
  return getProgramDerivedAddress({
    programAddress: programId(),
    seeds: [seed("stake"), pubkeyBytes(owner)],
  });
}

/** PDA: ["vault", listing] — holds the escrowed item while a listing is live. */
export async function vaultPda(listing: KitAddress): Promise<readonly [KitAddress, number]> {
  return getProgramDerivedAddress({
    programAddress: programId(),
    seeds: [seed("vault"), pubkeyBytes(listing)],
  });
}

/* ==========================================================================
   Instruction data

   Each builder returns just the `data` blob. Account metas are assembled by
   the adapter, which is the only place that knows the connected signer.
   ========================================================================== */

/** `Vec<(u8, u32)>` — resource kind discriminant paired with a quantity. */
function writeResourceBag(writer: BorshWriter, bag: ResourceBag): void {
  const entries = (Object.entries(bag) as [ResourceKind, number][]).filter(
    ([, qty]) => (qty ?? 0) > 0
  );
  // Sort by discriminant so the same logical bag always serialises identically
  // — otherwise a transaction's bytes would depend on JS object key order.
  entries.sort((a, b) => RESOURCE_U8[a[0]] - RESOURCE_U8[b[0]]);

  writer.u32(entries.length);
  for (const [kind, qty] of entries) {
    writer.u8(RESOURCE_U8[kind]);
    writer.u32(qty ?? 0);
  }
}

export function encodeInitPlayer(): Uint8Array {
  return new BorshWriter().bytes(instructionDiscriminator(IX.initPlayer)).finish();
}

export function encodeClaimYield(): Uint8Array {
  return new BorshWriter().bytes(instructionDiscriminator(IX.claimYield)).finish();
}

export function encodeSettleMining(bag: ResourceBag, energySpent: number): Uint8Array {
  const writer = new BorshWriter().bytes(instructionDiscriminator(IX.settleMining));
  writeResourceBag(writer, bag);
  // Energy is sent in hundredths so the program stays integer-only.
  writer.u32(Math.round(energySpent * 100));
  return writer.finish();
}

export function encodeSellResources(bag: ResourceBag): Uint8Array {
  const writer = new BorshWriter().bytes(instructionDiscriminator(IX.sellResources));
  writeResourceBag(writer, bag);
  return writer.finish();
}

export function encodeRefine(bag: ResourceBag): Uint8Array {
  const writer = new BorshWriter().bytes(instructionDiscriminator(IX.refine));
  writeResourceBag(writer, bag);
  return writer.finish();
}

export function encodePlaceBuilding(
  kind: BuildingKind,
  x: number,
  y: number,
  z: number,
  rotation: number
): Uint8Array {
  return new BorshWriter()
    .bytes(instructionDiscriminator(IX.placeBuilding))
    .u8(BUILDING_U8[kind])
    .i16(x)
    .i16(y)
    .i16(z)
    .u8(rotation)
    .finish();
}

export function encodeUpgradeBuilding(index: number): Uint8Array {
  return new BorshWriter()
    .bytes(instructionDiscriminator(IX.upgradeBuilding))
    .u8(index)
    .finish();
}

export function encodeRemoveBuilding(index: number): Uint8Array {
  return new BorshWriter()
    .bytes(instructionDiscriminator(IX.removeBuilding))
    .u8(index)
    .finish();
}

export function encodeCommitPack(kind: PackKind, clientSeedHash: Uint8Array): Uint8Array {
  return new BorshWriter()
    .bytes(instructionDiscriminator(IX.commitPack))
    .u8(PACK_U8[kind])
    .fixed(clientSeedHash, 32)
    .finish();
}

export function encodeRevealPack(clientSeed: Uint8Array): Uint8Array {
  return new BorshWriter()
    .bytes(instructionDiscriminator(IX.revealPack))
    .fixed(clientSeed, 32)
    .finish();
}

export function encodeListItem(priceRaw: bigint): Uint8Array {
  return new BorshWriter()
    .bytes(instructionDiscriminator(IX.listItem))
    .u64(priceRaw)
    .finish();
}

export function encodeCancelListing(): Uint8Array {
  return new BorshWriter().bytes(instructionDiscriminator(IX.cancelListing)).finish();
}

export function encodeBuyListing(maxPriceRaw: bigint): Uint8Array {
  // The buyer's accepted price is passed explicitly so a listing edited
  // between quote and confirmation fails rather than silently overcharging.
  return new BorshWriter()
    .bytes(instructionDiscriminator(IX.buyListing))
    .u64(maxPriceRaw)
    .finish();
}

export function encodeMakeOffer(amountRaw: bigint, expiresAtUnix: number): Uint8Array {
  return new BorshWriter()
    .bytes(instructionDiscriminator(IX.makeOffer))
    .u64(amountRaw)
    .i64(BigInt(Math.floor(expiresAtUnix)))
    .finish();
}

export function encodeAcceptOffer(): Uint8Array {
  return new BorshWriter().bytes(instructionDiscriminator(IX.acceptOffer)).finish();
}

export function encodeStake(amountRaw: bigint, lockDays: number): Uint8Array {
  return new BorshWriter()
    .bytes(instructionDiscriminator(IX.stake))
    .u64(amountRaw)
    .u16(lockDays)
    .finish();
}

export function encodeUnstake(): Uint8Array {
  return new BorshWriter().bytes(instructionDiscriminator(IX.unstake)).finish();
}

/* ==========================================================================
   Explorer links
   ========================================================================== */

export function explorerUrl(signature: string, cluster: string): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export function explorerAddressUrl(address: string, cluster: string): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}
