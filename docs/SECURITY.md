# Security and fairness

## The threat model

The client is hostile. It runs on the player's machine, they can read every byte of it,
and any determined person can patch it. That is not a flaw to be mitigated with
obfuscation — it is the starting assumption.

So the question is never "can a player cheat the client?" (yes, always) but **"what can a
patched client actually claim?"**

## Bounding hand mining

Hand mining is the hard case: it happens sixty times a second, driven by a physics
simulation the chain cannot see, and it produces value.

The insight the whole design leans on:

> **Energy is a pure function of elapsed time.**

Energy is stored as `(value, timestamp)` and *derived*, never ticked. So a program holding
only that pair and a clock can compute the maximum energy that could possibly have accrued
since the last settlement — independently, without trusting anything the client says.

Yield is then bounded by energy. The softest block in the game costs a known minimum, so:

```
max_blocks = energy_spent / MIN_BLOCK_ENERGY
max_units  = max_blocks × (100 + yield_bonus) / 100 + slack
```

A patched client can therefore choose **which** resources to claim — reporting voidstone
instead of dirt — but not **how much**. That turns a total break into a preference, and a
preference is a balance problem rather than a security one.

The residual: a cheater biases their haul toward the most valuable resource their energy
budget permits. Closing that fully means proving the world state transition — which block
was removed, from a world the program can regenerate from the claim seed — and that is
tractable but expensive. It is the right next step if real value is ever attached.

### Why not just make the server authoritative?

Because there is no server, and adding one would mean either (a) simulating a voxel
engine server-side at 60Hz per player, or (b) accepting client reports anyway with extra
steps. The energy bound gets most of the benefit for none of the cost, and it works
identically whether the authority is a program or a service.

### The tolerance

`ENERGY_TOLERANCE` is one block's worth. Clock skew between the client's projection and
`Clock::get()` is real and unavoidable; without slack, honest players lose batches at the
boundary. With too much, it becomes a free allowance. One block is enough to absorb
jitter and too little to farm.

## Crate fairness

### Why one transaction cannot work

A single "open crate" instruction has no honest source of randomness. Anything the program
can read at execution time — the clock, the slot, a recent blockhash — the caller can also
read *before* sending, simulate against, and simply not send when the result is bad. That
is not a lottery; it is a free reroll.

### The scheme

1. **Commit.** The player generates 32 secret bytes locally and sends only
   `sha256(secret)`. **The price is spent here.** That is what makes walking away from a
   bad roll cost exactly the same as taking it.
2. **Reveal.** The player publishes the secret. The program verifies it against the stored
   hash, then mixes it with the hash of the slot *after* the commit landed — a value that
   did not exist when the secret was chosen.

```
reveal_seed = sha256(client_seed ‖ slot_hash(commit_slot + 1) ‖ owner ‖ nonce)
```

Neither party can steer it. The player cannot predict a future slot hash; nobody else can
learn the secret.

**Binding to `commit_slot + 1`, not "most recent", is the load-bearing detail.** If the
player chose which slot's hash to use, they could wait for a favourable one — exactly the
grinding attack the commit was supposed to prevent.

### Verifiability

Every reveal publishes `client_seed`, `slot_hash`, the combined `reveal_seed`, and the
drop table version. Anyone can feed that seed to `openPack()` in
[`src/sim/packs.ts`](../src/sim/packs.ts) and get the same items back. The reveal UI shows
all of it behind one click.

Drop tables are constants in the repository, printed on the marketing page directly from
that source, and asserted in tests — including that every table sums to exactly
1,000,000ppm and that the Deep Core Vault's guaranteed floor holds.

### The limitations, stated plainly

Two, and neither is hidden:

1. **A player can decline to reveal.** They forfeit the price, so it is not profitable,
   but the option exists. It slightly truncates the observed distribution of *revealed*
   crates versus *opened* ones.
2. **A validator producing the commit slot has some influence** over the following slot's
   hash. Small, but nonzero, and it scales with how much a crate is worth.

Both are why the recommendation for any version with real value attached is a **VRF**
(ORAO or Switchboard) rather than slot hashes. The commit-reveal scheme here is honest and
checkable; it is not adversarially perfect, and pretending otherwise would be worse than
the limitation itself.

## Marketplace

| Risk | Mitigation |
| --- | --- |
| Seller lists an item then sells it elsewhere | Items are escrowed in a PDA-owned vault at list time |
| Buyer pays, item never arrives | Settlement is atomic — one instruction does payment, transfer, fee split and close |
| Price changes between quote and confirmation | `buy_listing` takes `max_price` as an exact upper bound and fails rather than overcharging |
| Offers backed by money already spent | Offer amounts are escrowed, not merely promised |
| Stale offers cluttering the book | Offers carry a mandatory expiry, capped at 30 days |
| Fee arithmetic leaking value | `fee_split` is integer-exact and unit-tested: `to_seller + fee == price` |
| Authority setting an extortionate fee | Hard-capped at 1,000bps in the program, not just the UI |

## Wallet and transaction handling

- **Connecting is read-only.** The wallet is used to derive a claim seed and label an
  inventory. Nothing is signed, and the dialog says so — "connect wallet" has been trained
  to mean "about to be asked to sign something", and that expectation deserves correcting
  rather than exploiting.
- **No private key ever touches this code.** Signing is delegated to the wallet through
  Wallet Standard.
- **Simulated receipts are labelled.** `TxReceipt.simulated` is surfaced in the UI so a
  mock signature is never mistaken for a settled transaction.
- **The client secret for a crate commit stays on the device** until the reveal
  transaction. That is the entire security property, so it is worth being explicit: the
  mock adapter mirrors this — its "chain" side only ever sees the hash until reveal.

## Reusing open-source code

[CREDITS.md](../CREDITS.md) records the licence and maintenance status of every project
studied, with explicit flags for the risky ones. Three categories mattered:

- **Strong copyleft.** `openbook-dex/openbook-v2` is GPL-3.0 on its instruction handlers.
  Copying would impose GPL-3.0 on this project. The design was studied; `phoenix-v1` (MIT)
  was used as the implementation reference instead.
- **No licence grant.** Several of the most on-point references — including the Solana
  DevRel game examples whose energy-regeneration pattern is closest to this design — carry
  no licence at all. Legally readable, not copyable. Those patterns were reimplemented
  from the published description.
- **Security-sensitive code specifically.** Escrow and randomness are exactly where a
  copied-and-lightly-edited pattern goes wrong, because the parts that look like
  boilerplate are the parts that matter. Both were written from the described algorithm
  rather than adapted, and both carry unit tests asserting the properties they exist to
  provide.

## Risks a player should know about

**Today: none that matter.** Nothing has value, no transaction is ever requested, and the
worst outcome is a wasted afternoon.

**If an on-chain version ships**, the risks are the ordinary ones and should be stated
without softening:

- **Smart contract risk.** These programs are unaudited. Unaudited programs lose funds.
- **Key loss.** Nobody can recover a lost wallet — not the developers, not anyone.
- **Item value.** Game items have no guaranteed value. A marketplace price is what someone
  paid once, not a floor.
- **Regulatory.** Tokenised game assets sit in an unsettled and jurisdiction-dependent
  area of law. Anyone deploying this commercially needs actual legal advice, which this
  document is not.
- **Not financial advice.** None of this is.

## Reporting something

Open a private security advisory on the repository rather than a public issue. If it
concerns deployed programs handling real value, please give a reasonable window before
disclosure.
