@AGENTS.md

# STRATA — working notes

A browser voxel mining city sim. Custom Three.js engine, Next.js 16, Tailwind v4,
with a chain abstraction that currently runs on a local simulator.

## Commands

```bash
npm run dev        # dev server on :3000
npm test           # vitest — 50 tests over the engine and economy
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

## Layer rules

Dependencies point one way and the codebase depends on it staying that way:

- `sim/` — pure game rules and data. No I/O, no React, no rendering. Imports nothing else.
- `game/` — the voxel engine. Imports `sim/`. **Never** imports `onchain/` or `ui/`.
- `onchain/` — the chain seam. Imports `sim/`.
- `ui/` — everything visible. Imports all of the above.

**No UI file may import an adapter implementation directly.** Use `useChain()`.

## Things that will bite you

- **Floats are banned on consequential paths.** Drop weights are parts-per-million, energy
  is hundredths, rarity scaling is permille. The Rust program has to reach bit-identical
  results from the same seed, and `f64` rounding differs between BPF and x86.
- **Wire discriminants in `sim/types.ts` are append-only.** Renumbering a variant
  silently reinterprets existing on-chain accounts.
- **Token amounts are always `bigint` base units.** Never `number`. Format at the edge
  with `formatToken`.
- **`toLocaleString()` in a server-rendered component is a hydration bug.** Use
  `src/lib/format.ts`, which pins the locale. Browser-only strings (toasts, errors) may
  use the user's locale and do.
- **Don't yield on `requestAnimationFrame` for long work.** Hidden tabs stop firing it
  entirely. Use `TimeSlice` from `src/lib/schedule.ts`.
- **The engine owns its own loop and writes frame-rate values straight to the DOM.**
  Energy, mining progress and FPS never go through React state.
- **The canvas is created imperatively in an effect**, not rendered by React. StrictMode
  mounts twice, and a canvas only ever hands out one WebGL context — the second engine
  would inherit a disposed one.

## Editing the economy

Change a number, then run `npm test`. The suite asserts design invariants, not just
behaviour: refining must beat selling raw by >2.5×, drop tables must sum to exactly
1,000,000ppm, the Deep Core Vault's Rare floor must hold, fee splits must reconcile
exactly. It has already caught one case where the constants contradicted the design doc.

## Chain layer

`NEXT_PUBLIC_CHAIN_MODE` selects the adapter (`mock` by default). The Solana adapter has
real PDAs, real Anchor discriminators and real borsh encoding; only `#send` and the
account decoders are unimplemented, because the programs are not deployed. See
`docs/ONCHAIN.md` for the go-live checklist.

There is no token and none is planned in the near term. Don't add one, and don't write
copy implying one exists.
