# Roadmap

Ordered by what makes it a game, not by what is easiest to announce.

Each phase maps to a GitHub milestone. Work happens on branches, every PR gets a Vercel
preview, and `main` deploys to production.

---

## Phase 1 — Playable claim ✅ shipped

**Goal:** a browser voxel game you can load and immediately do something in.

| Deliverable | Complexity | Depends on |
| --- | --- | --- |
| Voxel engine: chunked meshing, vertex AO, colour jitter | High | — |
| Seeded worldgen: five strata, seven ores, cave carving | Medium | Engine |
| DDA raycasting and hand mining with an energy budget | Medium | Engine |
| RTS orbit camera with touch support | Medium | Engine |
| `ChainAdapter` interface + complete simulated implementation | High | — |
| Wallet Standard connection, read-only | Low | — |
| Design system, landing page, hero diorama | Medium | — |
| Test suite over engine and economy | Medium | All of the above |

**Why this order.** The engine had to come first because everything visible depends on it,
and the chain abstraction had to come first because retrofitting one is where projects
like this fail.

---

## Phase 2 — City and economy ✅ shipped

**Goal:** a reason to come back tomorrow that isn't a daily-login bribe.

| Deliverable | Complexity | Depends on |
| --- | --- | --- |
| Seven buildings with worker and power constraints | Medium | Phase 1 |
| Procedural voxel building models, stamped into the world | Medium | Engine |
| Passive extraction with descending bores | Medium | Buildings |
| Smelting recipes and the ~4× refining multiplier | Low | Resources |
| Placement validation, ghosts, foundations | Medium | Engine, buildings |
| XP, levels, and unlock gating | Low | — |
| Offline settlement, capped and idempotent | Medium | Production sim |

**The load-bearing idea** is the extractor bore: it makes *time* a resource with a
direction, so an unattended claim gets better on its own.

---

## Phase 3 — Crates and market 🔶 in progress

**Goal:** something to spend on, and somewhere for price to be discovered.

| Deliverable | Complexity | Depends on | Status |
| --- | --- | --- | --- |
| Commit-reveal crate opening with published odds | High | Adapter | ✅ |
| Item archetypes, rarity scaling, quality rolls | Medium | — | ✅ |
| Reveal animation with in-line verification | Medium | Crates | ✅ |
| Marketplace: listings, buys, offers, fee splits | High | Adapter | ✅ |
| Simulated order book that drifts over time | Medium | Market | ✅ |
| Salvage floor pricing | Low | Items | ✅ |
| Staking with lock periods | Low | Adapter | ⬜ UI not built |
| Contracts / quests | Medium | Economy | ⬜ |
| Economy tuning against real play data | High | Players | ⬜ |

The last row is the real work and cannot be done alone. The targets in
[ECONOMY.md](ECONOMY.md) are guesses until someone plays for twenty hours.

---

## Phase 4 — On-chain ⬜ next

**Goal:** flip the adapter, change nothing else.

| Deliverable | Complexity | Depends on |
| --- | --- | --- |
| Anchor programs written and unit-tested | High | ✅ done |
| Localnet integration tests against the real client encoding | Medium | Programs |
| Differential test: TS `openPack` vs Rust `reveal_pack` over shared seeds | Medium | Programs |
| `SolanaChainAdapter.#send` + account decoders | Medium | Deploy |
| Item custody decision: cNFT vs packed account | High | — |
| Indexer service for listings and leaderboards | High | Programs |
| Devnet deploy and a public test | Medium | All of the above |
| Third-party program review | High | Everything |

**Nothing touches mainnet before that last row.** Unaudited programs lose funds; that is
not a risk to be accepted quietly.

The differential test is the highest-value item and the easiest to skip. The client and
the program implement the same rules twice in two languages; the only real defence against
drift is running both over the same inputs and comparing.

---

## Phase 5 — Polish and community ⬜ later

| Deliverable | Complexity |
| --- | --- |
| Web Worker meshing (main thread is fine today; won't be with bigger claims) | Medium |
| Larger or streaming claims | High |
| Scanner ore-overlay rendering | Medium |
| Sound: mining impacts, ambient depth, reveal stingers | Medium |
| Seasons or leaderboard resets | Medium |
| Mobile-first control scheme | High |
| Localisation (`src/lib/format.ts` is the only place that knows about locales) | Medium |

---

## Deliberately not on this roadmap

- **A token.** See [ONCHAIN.md](ONCHAIN.md). It is the last step, if ever, and the
  economics get published before anything deploys.
- **Player-versus-player claim raiding.** Your ground is yours. Competition belongs in the
  marketplace.
- **Energy purchases.** Energy is the design constraint; selling a way around it would
  delete the game.
- **Referral or recruitment rewards.** The economy works the same at ten players and ten
  thousand, and it should stay that way.

---

## Working agreements

- `main` is always deployable. If it's red, that's the only thing anyone is working on.
- Every economy change ships with a test asserting the invariant it is meant to preserve.
  `economy.test.ts` has already caught one case where the numbers contradicted the design
  document.
- Anything touching `programs/` or `src/onchain/` gets reviewed by someone else, without
  exception.
- Numbers quoted in the UI or on the site come from the same constants the game reads at
  runtime. No hardcoded marketing figures — they go stale and become lies.
