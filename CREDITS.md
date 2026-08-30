# Credits

Open-source projects whose code, patterns, or APIs informed STRATA.

Every repository below was resolved through the GitHub API on **2026-08-30**, which follows
rename/transfer redirects — that is how the `solana-labs` → `anza-xyz`/`solana-foundation`,
`coral-xyz/anchor` → `otter-sec/anchor`, and `framer/motion` → `motiondivision/motion` moves
were caught. Licenses were read from each repo's `LICENSE`, `package.json`, or `Cargo.toml`
rather than trusting GitHub's classifier.

**Legend** — ⚠️ license or maintenance caveat · 🚨 do not copy code from this.

---

## Directly depended on

These ship in `package.json` and their code runs in production.

| Package | Repo | License |
| --- | --- | --- |
| `three` | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT |
| `next`, `react` | [vercel/next.js](https://github.com/vercel/next.js) | MIT |
| `tailwindcss` | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) | MIT |
| `zustand` | [pmndrs/zustand](https://github.com/pmndrs/zustand) | MIT |
| `motion` | [motiondivision/motion](https://github.com/motiondivision/motion) | MIT |
| `simplex-noise` | [jwagner/simplex-noise.js](https://github.com/jwagner/simplex-noise.js) | MIT |
| `@solana/kit` | [anza-xyz/kit](https://github.com/anza-xyz/kit) | MIT |
| `@wallet-standard/*` | [wallet-standard/wallet-standard](https://github.com/wallet-standard/wallet-standard) | Apache-2.0 |
| `@noble/hashes` | [paulmillr/noble-hashes](https://github.com/paulmillr/noble-hashes) | MIT |

---

## 1. Voxel engines, chunked terrain, greedy meshing

The core prior art for chunked voxel worlds in JavaScript. Most of the canonical work here is
old — the algorithms are still correct, the surrounding code is not modern. STRATA reimplements
rather than vendors, but the algorithms come from here.

- **[fenomas/noa](https://github.com/fenomas/noa)** — MIT ⚠️ *last push 2023-07*
  Complete JS voxel engine: chunk streaming, block registry, AABB physics, ECS (Babylon-based).
  *Borrowed:* chunk lifecycle design and the block-type registry shape.
- **[Divine-Star-Software/DivineVoxelEngine](https://github.com/Divine-Star-Software/DivineVoxelEngine)** — MIT
  Multi-threaded, renderer-independent TypeScript voxel engine with worker-based meshing.
  *Borrowed:* the renderer-agnostic split between voxel data and mesh generation.
- **[mikolalysenko/greedy-mesher](https://github.com/mikolalysenko/greedy-mesher)** — MIT ⚠️ *2016*
  Reference greedy meshing over a voxel volume, by the author of "Meshing in a Minecraft Game".
  *Borrowed:* the quad-merging algorithm behind `src/game/mesher.ts`.
- **[mikolalysenko/ao-mesher](https://github.com/mikolalysenko/ao-mesher)** — MIT ⚠️ *2014*
  Voxel mesher that bakes per-vertex ambient occlusion into generated geometry.
  *Borrowed:* the vertex-AO computation and the flip-quad-diagonal trick — cheap and the single
  biggest visual win for blocky terrain without a lighting pass.
- **[PrismarineJS/prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer)** — MIT *(active)*
  Renders live Minecraft worlds in the browser with Three.js, meshing chunks in Web Workers.
  *Borrowed:* incremental chunk add/remove against a live, mutating world.
- **[max-mapper/voxel-engine](https://github.com/max-mapper/voxel-engine)** — BSD-3-Clause ⚠️ *2017*
  The original voxel.js engine.
  *Borrowed:* its decomposition of highlight / player / physics / control into separate systems.

Secondary references: [Overv/WebCraft](https://github.com/Overv/WebCraft) (Zlib ⚠️ 2020),
[simondevyoutube/MinecraftClone](https://github.com/simondevyoutube/MinecraftClone) (MIT ⚠️ 2020),
[vanruesc/rabbit-hole](https://github.com/vanruesc/rabbit-hole) (Zlib ⚠️ 2023, SVO/dual contouring),
[VoxelSrv/voxelsrv](https://github.com/VoxelSrv/voxelsrv) (MIT 🚨 **archived** 2021).
🚨 [dgreenheck/minecraft-threejs-clone](https://github.com/dgreenheck/minecraft-threejs-clone) —
**no license grant**; read only, nothing copied.

## 2. Three.js ecosystem

- **[pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber)** — MIT ·
  React renderer for Three.js. *Considered and deliberately not used* — see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why a hand-rolled chunk manager won here.
- **[pmndrs/drei](https://github.com/pmndrs/drei)** — MIT · helper library; its
  `AdaptiveDpr`/`PerformanceMonitor` approach informed the adaptive resolution scaler.
- **[pmndrs/postprocessing](https://github.com/pmndrs/postprocessing)** — Zlib · merged-pass
  effect composer; informed the decision to bake lighting into vertex colours instead.
- **[gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)** — MIT · BVH for fast
  raycasts. Not needed here: voxel DDA beats a BVH for a uniform grid.
- **[mrdoob/stats.js](https://github.com/mrdoob/stats.js)** — MIT ⚠️ *2024* · informed the
  built-in frame-time readout.

## 3. Noise and procedural generation

- **[jwagner/simplex-noise.js](https://github.com/jwagner/simplex-noise.js)** — MIT · **used
  directly.** Its injectable PRNG is what makes claims reproducible from a wallet-derived seed.
- **[Auburn/FastNoiseLite](https://github.com/Auburn/FastNoiseLite)** — MIT · cellular/Worley
  noise and domain warping. *Borrowed:* the domain-warp idea for strata boundaries, and the
  cellular approach to ore-vein placement.
- **[joshforisha/fast-simplex-noise-js](https://github.com/joshforisha/fast-simplex-noise-js)** —
  Unlicense (public domain) · *Borrowed:* octave/fBm summing helpers.
- **[davidbau/seedrandom](https://github.com/davidbau/seedrandom)** — MIT ⚠️ *README only* ·
  reference for deterministic PRNG design.
- **[scijs/ndarray](https://github.com/scijs/ndarray)** — MIT · strided arrays; the input format
  `greedy-mesher` and `ao-mesher` expect.

## 4. Solana wallet and JS client

- **[anza-xyz/kit](https://github.com/anza-xyz/kit)** — MIT · `@solana/kit`, the modern
  tree-shakable SDK (the renamed web3.js 2.x line). **Used directly** in
  `src/onchain/solana/`.
- **[anza-xyz/wallet-adapter](https://github.com/anza-xyz/wallet-adapter)** — Apache-2.0 ·
  *Borrowed:* the `WalletProvider` / `useWallet` seam, reimplemented in
  `src/onchain/wallet/` against Wallet Standard directly. Not depended on, because it pulls the
  entire React Native/Metro toolchain into a web build (15 advisories, ~0 benefit).
- **[wallet-standard/wallet-standard](https://github.com/wallet-standard/wallet-standard)** and
  **[anza-xyz/wallet-standard](https://github.com/anza-xyz/wallet-standard)** — Apache-2.0 ·
  **used directly** for wallet discovery and feature negotiation.
- **[solana-foundation/solana-web3.js](https://github.com/solana-foundation/solana-web3.js)** —
  MIT ⚠️ *1.x maintenance line only* · the version most Anchor tooling still assumes.
- **[gillsdk/gill](https://github.com/gillsdk/gill)** — MIT · higher-level client over Kit;
  a candidate if send-and-confirm boilerplate grows.

## 5. Anchor and on-chain program patterns

- **[otter-sec/anchor](https://github.com/otter-sec/anchor)** — Apache-2.0 · the Anchor
  framework. *Note the move:* `coral-xyz/anchor` and `solana-foundation/anchor` both redirect
  here; maintenance is now with OtterSec. *Borrowed:* account constraints, PDA derivation, and
  the 8-byte instruction discriminator scheme reimplemented in `src/onchain/solana/ix.ts`.
- **[orao-network/solana-vrf](https://github.com/orao-network/solana-vrf)** — Apache-2.0 ·
  verifiable randomness with a callback flow. *Borrowed:* the request/fulfill shape that
  `programs/strata-packs` is designed to migrate to; see
  [docs/SECURITY.md](docs/SECURITY.md) on why commit-reveal alone is not enough at scale.
- **[ironaddicteddog/anchor-escrow](https://github.com/ironaddicteddog/anchor-escrow)** — MIT
  ⚠️ *2024-08* · canonical PDA-as-vault-authority escrow. *Borrowed:* the escrow pattern behind
  `programs/strata-market` listings.
- **[Ellipsis-Labs/phoenix-v1](https://github.com/Ellipsis-Labs/phoenix-v1)** — MIT ·
  fully on-chain limit order book with atomic settlement. The strongest permissively-licensed
  market reference; informed the offer/accept design.
- **[magicblock-labs/bolt](https://github.com/magicblock-labs/bolt)** — MIT · ECS for on-chain
  games. *Borrowed:* component/system separation for world state (plots, buildings, inventories).
- **[magicblock-labs/ephemeral-rollups-sdk](https://github.com/magicblock-labs/ephemeral-rollups-sdk)**
  — MIT ⚠️ *manifest only* · account delegation for high-frequency writes. The standard answer to
  "a mining tick cannot be an L1 transaction"; noted as the Phase 3 scaling path.
- **[solana-program/token](https://github.com/solana-program/token)** /
  **[token-2022](https://github.com/solana-program/token-2022)** — Apache-2.0, active.

**Not used, on purpose:**
- 🚨 **[openbook-dex/openbook-v2](https://github.com/openbook-dex/openbook-v2)** — **GPL-3.0** on
  `programs/openbook-v2/src/instructions/`. Copying would impose GPL-3.0 on this project.
  Design studied only; `phoenix-v1` (MIT) used as the implementation reference instead.
- ⚠️ **[metaplex-foundation/mpl-core](https://github.com/metaplex-foundation/mpl-core)** and
  `mpl-token-metadata`, `mpl-bubblegum` — "Metaplex(TM) NFT Open Source License v1.0", a custom
  non-OSI licence. Calling the deployed programs via CPI is a different question from copying
  source; read the terms first.
- 🚨 **[solana-labs/solana-program-library](https://github.com/solana-labs/solana-program-library)**
  — Apache-2.0 but **archived** 2025-03. Superseded by the `solana-program/*` repos.

## 6. Example collections and scaffolds

- **[solana-foundation/program-examples](https://github.com/solana-foundation/program-examples)**
  — MIT · `tokens/escrow` for the vault pattern, `games/gacha` for randomized on-chain rewards.
- **[solana-foundation/create-solana-dapp](https://github.com/solana-foundation/create-solana-dapp)**
  — MIT · its generated client/program boundary was a useful sanity check on where the adapter
  seam belongs.
- **[magicblock-labs/magicblock-engine-examples](https://github.com/magicblock-labs/magicblock-engine-examples)**
  — MIT · runnable delegate/act/undelegate examples.
- **[coral-xyz/anchor-book](https://github.com/coral-xyz/anchor-book)** — Apache-2.0 ⚠️ *2024-12*
  · its escrow and PDA chapters explain the *why* behind the constraints.
- ⚠️ **[solana-developers/solana-game-examples](https://github.com/solana-developers/solana-game-examples)**
  — **no license grant.** Its energy-regeneration-over-time pattern is almost exactly a mining
  stamina system and is the most on-point reference for this project. **Read for design only —
  no code copied.** STRATA's energy model in `src/sim/economy.ts` is an independent
  implementation of the same well-known idea (store `lastRefillAt`, derive current energy from
  elapsed time rather than writing on a timer).

## 7. UI and components

- **[shadcn-ui/ui](https://github.com/shadcn-ui/ui)** — MIT · copy-into-repo component patterns;
  informed the primitives in `src/ui/primitives.tsx`.
- **[radix-ui/primitives](https://github.com/radix-ui/primitives)** — MIT · *Borrowed:* correct
  focus trapping and keyboard handling for overlays — critical when a modal opens over a canvas
  that is also listening for keyboard input.
- **[lucide-icons/lucide](https://github.com/lucide-icons/lucide)** — ISC · icon geometry
  reference. STRATA draws its own blocky icon set to match the voxel theme.
- **[emilkowalski/sonner](https://github.com/emilkowalski/sonner)** — MIT · *Borrowed:* the
  stacking-toast model for transaction lifecycle feedback.

## 8. State management

- **[pmndrs/zustand](https://github.com/pmndrs/zustand)** — MIT · **used directly.** Its
  transient `subscribe` API lets the render loop read state at 60fps without re-rendering React.
- **[TanStack/query](https://github.com/TanStack/query)** — MIT · informed the cache/invalidate
  policy in `src/onchain/ChainProvider.tsx`; a natural upgrade when RPC reads become real.
- **[immerjs/immer](https://github.com/immerjs/immer)** — MIT · structural-sharing reducers.

---

## Licence risk summary

| Concern | Repositories | Consequence |
| --- | --- | --- |
| 🚨 Strong copyleft | `openbook-dex/openbook-v2` (GPL-3.0 on `instructions/`) | Copying would impose GPL-3.0 on this project. Design studied only. |
| ⚠️ Custom non-OSI | `metaplex-foundation/mpl-*` | Read the terms before adapting source. |
| ⚠️ No licence grant | `dgreenheck/minecraft-threejs-clone`, `solana-developers/solana-game-examples`, `solana-developers/solana-game-preset`, `solana-developers/solana-cookbook`, `switchboard-xyz/sb-on-demand-examples` | Legally readable, not copyable. Patterns reimplemented from scratch. |
| ⚠️ Licence in manifest/README only | `davidbau/seedrandom`, `switchboard-xyz/solana-sdk`, `magicblock-labs/ephemeral-rollups-sdk`, `pmndrs/use-cannon` | Permissive and usable; GitHub's badge shows "none". |
| 🚨 Archived | `solana-labs/solana-program-library`, `solana-labs/dapp-scaffold`, `VoxelSrv/voxelsrv` | Not built on. Each has a named successor. |
| ⚠️ Unmaintained 2+ yrs | `fenomas/noa`, `mikolalysenko/greedy-mesher`, `mikolalysenko/ao-mesher`, `max-mapper/voxel-engine` | Algorithms remain valid; reimplemented rather than depended on. |

MIT, Apache-2.0, ISC, Zlib, BSD-3-Clause and Unlicense are all safe to adapt from with
attribution. Apache-2.0 additionally requires preserving `NOTICE` files and carries an explicit
patent grant. Unlicense is public domain and requires no attribution at all.

Nothing in this repository is copied verbatim from a source that does not permit it. Where a
pattern is well known (voxel AO, DDA raycasting, PDA escrow, energy regeneration) it has been
reimplemented from the published description rather than pasted.
