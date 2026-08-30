# The chain layer

## Position on a token

**There isn't one, and adding one is the last step, not the first.**

No mint exists, none is offered, and the in-game balance is a number in local storage. If
that ever changes, the economics get published before anything is deployed, and this
document gets rewritten rather than quietly amended.

The reasoning is simple: a game economy should be worth playing before it is worth
anything else. Attaching real money to a loop nobody has stress-tested converts every
balance mistake into someone's actual loss, and it changes who shows up — from people who
want to play to people who want an exit.

What *is* built is the seam. `GameConfig.tokenMint` is `Option<Pubkey>` in the program and
`Address | null` in the client, and both handle `null` as a normal state rather than an
error. The game is fully playable with no token, which is the property that makes the
decision reversible in both directions.

## The interface

Everything that touches ownership or currency goes through one interface,
[`ChainAdapter`](../src/onchain/adapter.ts). Two implementations satisfy it:

| | `MockChainAdapter` | `SolanaChainAdapter` |
| --- | --- | --- |
| State | `localStorage` | Program accounts |
| Latency | Simulated 150–900ms | Real |
| Failures | Simulated, same error codes | Real |
| Signatures | Valid-shaped base58, `simulated: true` | Real, with explorer links |
| Randomness | Same commit-reveal scheme | SlotHashes sysvar |
| Status | **Complete** | Wallet + RPC + encoding done; writes stop at `#send` |

Selection is `NEXT_PUBLIC_CHAIN_MODE`. `resolveChainMode()` refuses to leave mock mode
unless `NEXT_PUBLIC_PROGRAM_ID` is also set — a half-configured deployment falls back to
something playable rather than throwing on first render.

## What already works against a real cluster

Not stubs. These run today:

- **Wallet discovery and connection** via Wallet Standard — Phantom, Solflare, Backpack,
  anything conforming. Implemented directly in
  [`src/onchain/wallet/standard.ts`](../src/onchain/wallet/standard.ts) rather than via
  `@solana/wallet-adapter-react`, which pulls the React Native and Metro toolchain into a
  web build for no benefit.
- **RPC** through `@solana/kit`. `getSolBalance()` is a live call and is genuinely useful
  before any program exists: it proves the endpoint, the wallet and the address are all
  wired correctly.
- **PDA derivation** — every seed in [`program.ts`](../src/onchain/solana/program.ts)
  matches the `seeds = [...]` constraints in the Rust.
- **Anchor discriminators**, derived as `sha256("global:<snake_case_name>")[0..8]` rather
  than hardcoded, so renaming an instruction in Rust surfaces as a failing test here.
- **Borsh encoding** — a minimal writer/reader in
  [`borsh.ts`](../src/onchain/solana/borsh.ts) covering exactly the types the
  instructions use.

Splitting it this way is deliberate. The expensive, error-prone half of a Solana
integration is account ordering, seeds and byte layouts — and all of that can be verified
against a localnet the day the programs compile, instead of being written in a rush on
deploy day.

## The programs

Three, in [`programs/`](../programs), so they can be upgraded independently.

### `strata-core`

Config, claims, mining settlement, city state.

The interesting instruction is `settle_mining`, and its two `require!`s are the entire
anti-cheat story:

```rust
// You cannot spend energy you could not have had.
let available = player.current_energy(now);
require!(spent <= available + ENERGY_TOLERANCE, EnergyOverclaim);

// Energy buys a bounded number of blocks.
let max_blocks = spent / MIN_BLOCK_ENERGY;
let max_units  = max_blocks * (100 + yield_bonus) / 100 + 4;
require!(claimed <= max_units, YieldOverclaim);
```

Energy is stored as `(value, timestamp)` and derived, never ticked — which is what makes
it computable by the program from state it already holds. See [SECURITY.md](SECURITY.md).

`claim_yield` takes **no arguments at all**. The program derives passive output from
elapsed seconds and the buildings it already stores, so there is nothing for a modified
client to inflate. The window is capped at seven days.

### `strata-packs`

Commit-reveal randomness. Two transactions:

1. `commit_pack(kind, sha256(secret))` — the price is spent **here**, which is what makes
   abandoning a bad roll cost the same as taking it.
2. `reveal_pack(secret)` — verifies the hash, reads the hash of the slot *after* the
   commit from the SlotHashes sysvar, and derives
   `sha256(secret ‖ slot_hash ‖ owner ‖ nonce)`.

Binding to `committed_slot + 1` rather than "the most recent slot" is the load-bearing
detail. If the player could choose which slot's hash to use, they could wait for a
favourable one — which is precisely the grinding attack the commit was meant to prevent.
The cost is a ~500-slot reveal window; outside it the reveal fails rather than silently
substituting different entropy.

### `strata-market`

Escrowed listings, direct buys, offers.

- Listed items move into a PDA-owned vault, so a seller cannot list something and then
  sell it elsewhere.
- Settlement is atomic — payment out, item in, fee split, listing closed, one instruction.
- `buy_listing` takes `max_price`. Not a slippage tolerance; an exact upper bound, because
  there is no legitimate reason for a fixed-price listing to cost more than the number the
  buyer clicked on.
- `fee_split` is integer arithmetic that always reconciles: `to_seller + fee == price` and
  `to_treasury + to_burn == fee`. A split that loses a lamport per trade is a slow leak.

## Keeping the two sides in sync

The client and the program implement the same rules twice, in different languages. That is
a real hazard, and it is managed rather than wished away:

1. **Integers only on consequential paths.** Drop weights are parts-per-million, energy is
   hundredths, stat scaling is permille. `f64` rounding differs between BPF and x86; a
   mismatch would mean a rejected transaction the player cannot explain.
2. **Explicit wire discriminants.** Every enum in `src/sim/types.ts` carries a documented
   `u8` value with an append-only rule. Renumbering a variant would silently reinterpret
   existing accounts.
3. **Tests on the TypeScript side, unit tests on the Rust side.** `economy.test.ts` pins
   the client's tables; `#[cfg(test)]` blocks in each program pin the Rust equivalents.
   Both assert the same invariants — drop tables summing to exactly 1,000,000ppm, luck
   preserving the total, the Deep Core floor holding, fee splits reconciling.
4. **A versioned drop table.** `DROP_TABLE_VERSION` is written into every reveal, so
   historical rolls stay auditable against the table that was live when they happened.

The remaining risk is that someone edits one side and not the other. The mitigation is a
planned differential test: run both implementations over the same seeds and compare — see
"Not built yet" below.

## Going live: the checklist

1. `anchor build && anchor keys sync` — rewrites `declare_id!` and `Anchor.toml` from the
   generated keypairs.
2. `anchor deploy --provider.cluster devnet`.
3. Call `initialize_config` once with the treasury and fee parameters.
4. Set `NEXT_PUBLIC_PROGRAM_ID` and `NEXT_PUBLIC_CHAIN_MODE=devnet` in Vercel.
5. Implement `SolanaChainAdapter.#send` using the wallet's
   `solana:signAndSendTransaction` feature. This is the one genuinely open design
   decision — whether to sign-and-send through the wallet or sign locally and send
   ourselves, which is a question about priority-fee control.
6. Fill in the account decoders. `borsh.ts` already covers every field type used.
7. Stand up the indexer. `getListings` and `getLeaderboard` cannot be
   `getProgramAccounts` calls from a browser at any real scale.
8. Get the programs reviewed by someone who did not write them, **before** mainnet.

Steps 1–4 are configuration. Steps 5–6 are a few hundred lines against layouts that
already exist. Step 7 is the real work.

## Not built yet, and honest about it

- **Item custody.** Items are modelled as an `ItemId` that will map to a compressed NFT
  asset id. Bubblegum versus a packed inventory account is a real trade-off — cNFTs are
  composable and cheap to mint but need an indexer to read; a packed account is trivial to
  read but the items only exist inside this game. Not decided.
- **The indexer.** Sketched in the adapter's paged query shapes, not written.
- **Write batching at scale.** Hand mining already batches into one settlement per ~30
  blocks or 12 seconds, which is the right shape. If that proves too heavy, ephemeral
  rollups are the escape hatch.
- **A differential test harness.** The highest-value missing piece: run `openPack` in
  TypeScript and `reveal_pack` in Rust over a shared corpus of seeds and assert they agree
  byte for byte. Everything is already structured to make this possible; it just isn't
  written.
