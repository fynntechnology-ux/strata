<div align="center">

# STRATA

**A voxel mining city, dug one block at a time.**

Sink a shaft through five layers of rock, refine what you haul up, and build the city
that keeps digging while you're gone. Runs in a browser, needs no wallet, and has no token.

[Play](https://strata-game.vercel.app/play) · [Architecture](docs/ARCHITECTURE.md) ·
[Game design](docs/GDD.md) · [Chain layer](docs/ONCHAIN.md) · [Security](docs/SECURITY.md)

</div>

---

## What this is

A complete browser voxel game — custom engine, procedural terrain, city building,
crate opening, a marketplace — sitting on top of a chain abstraction with two
implementations: a **simulated adapter** that runs everything locally today, and a
**Solana adapter** with real PDAs, real instruction encoding and real wallet support
waiting on a deploy.

**There is no token.** None has been minted, none is for sale, and the in-game balance
is a number in your browser's local storage. The chain layer exists because retrofitting
one is where projects like this usually fall over — doing it up front forces the hard
parts (idempotent settlement, batched writes, verifiable randomness, a client that
handles slow and failing transactions) into the design instead of bolting them on later.

## Quick start

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. Click **Play now — no wallet**; the claim generates in
about two seconds.

```bash
npm test          # 50 tests over the engine and the economy
npm run typecheck # tsc --noEmit
npm run build     # production build
```

## What's actually working

| | |
| --- | --- |
| **Voxel engine** | 614,400-voxel bounded claim, chunked meshing with per-vertex ambient occlusion, DDA raycasting, adaptive resolution. No textures — form, AO and per-voxel colour jitter do the work. |
| **Terrain** | Five strata bands, seven ores gated by depth, noise-carved cave systems, all derived from a single seed. Same wallet, same ground, forever. |
| **Mining** | Click-and-hold with a real energy budget. Energy is derived from elapsed time, never ticked, which is also what makes it verifiable on-chain. |
| **City** | Seven buildings with worker and power constraints. Extractors bore downward over time and reach richer strata the longer they run. |
| **Crates** | Commit-reveal randomness with published, verifiable odds. Every reveal ships the seed it was computed from. |
| **Marketplace** | Listings, offers, fee splits, salvage floor pricing, and a simulated order book that drifts over time. |
| **Chain layer** | One `ChainAdapter` interface, two implementations. Switching is an environment variable. |

## Repository layout

```
src/
  app/          Next.js routes — landing page and /play
  game/         The voxel engine. Knows nothing about React or the chain.
    blocks.ts     Block registry, colours, hardness
    worldgen.ts   Seeded terrain, strata, ore veins, caves
    mesher.ts     Chunk meshing with vertex AO
    world.ts      Voxel storage, edits, DDA raycasting
    renderer.ts   Three.js scene management
    controls.ts   RTS orbit camera
    engine.ts     The game loop
  sim/          Game rules as pure functions. No I/O, no rendering.
    economy.ts    Every formula. Same code the program will mirror.
    packs.ts      Drop tables and the reference pack-opening implementation
    store.ts      Client state (zustand)
  onchain/      The seam between the game and a blockchain
    adapter.ts    The interface both implementations satisfy
    mock/         The simulated chain — local, deterministic, fallible
    solana/       Real PDAs, discriminators and borsh encoding
  ui/           Design system, landing sections, HUD, panels
programs/       Anchor programs (Rust), written but not deployed
docs/           Architecture, game design, economy, chain, security
```

## Design decisions worth knowing about

**The voxel engine is hand-rolled, not react-three-fiber.** A voxel world rebuilds
geometry constantly, and R3F's model — scene graph as a function of React state — fights
that. Direct Three.js keeps geometry lifetimes explicit, which is the thing that actually
matters for not leaking GPU memory.

**Wallet support talks to Wallet Standard directly.** `@solana/wallet-adapter-react`
works, but it depends on `@solana-mobile/wallet-adapter-mobile`, which drags the entire
React Native and Metro toolchain into a web build — 200+ packages and 15 npm advisories,
none of which ever reach the browser bundle. The part actually needed was about eighty
lines; it lives in [`src/onchain/wallet/standard.ts`](src/onchain/wallet/standard.ts).

**Consequential randomness is integer-only.** Pack rolls are computed from SHA-256 over
integer arithmetic with weights in parts-per-million, never floats — because `f64`
rounding differs between platforms and the Rust program has to reach bit-identical
results from the same seed.

**Hand-mined yield is bounded by energy, not trusted.** Energy is a pure function of
elapsed time, so a program can independently compute the maximum that could have accrued
and reject anything above it. A patched client can choose *which* resources to claim but
not *how much*. See [docs/SECURITY.md](docs/SECURITY.md).

**The economy has real sinks.** Currency leaves circulation on every crate, building,
upgrade and market fee. Refining roughly quadruples the value of raw ore, which is what
makes building infrastructure strictly better than selling everything — the property that
keeps a city builder from collapsing into a click farm.

## Deployment

Pushes to `main` deploy to production on Vercel; every other branch gets a preview URL.
The build needs no environment variables — with none set, the game runs on the simulated
adapter, which is the intended default.

## Not financial advice

STRATA is a game and a technical demonstration. The in-game currency is simulated and has
no monetary value. No token has been issued, none is offered for sale, and nothing here
is an investment offer. If an on-chain version ever ships, the risks are the usual ones:
smart contract bugs, key loss, and game items having no guaranteed value.

## Credits

Built on the shoulders of a lot of open-source work — see [CREDITS.md](CREDITS.md), which
records every project studied or depended on along with its licence and any caveats.

## Licence

MIT — see [LICENSE](LICENSE).
