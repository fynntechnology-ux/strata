# Game design

## The pitch

You own a plot of layered rock. You dig into it by hand, and what you pull up pays for
machines that dig without you. The machines dig deeper than you can be bothered to, and
what *they* pull up is worth more. The game is the loop between those two facts.

## The one-sentence design constraint

**Depth gates value, not grind.** You never reach titanium by mining more iron. You reach
it by going deeper, which costs harder tools and more energy per swing. Every system in
the game exists to make going deeper possible.

---

## Mining

### Hand mining

Click and hold a block. It breaks after `420ms × hardness ÷ (1 + miningSpeed%)`, and
costs `1.15 × hardness × (1 + energyCost%)` energy — minimum 0.25.

**Energy is the whole design.** It starts at 100, regenerates 2.4/second, and is the only
limit on hand mining. It is not a stamina bar borrowed from another genre; it is the thing
that makes every other system matter:

- It makes mining a *choice*. You cannot brute-force your way down, so the question is
  never how fast you can click but what you spend a finite budget on.
- It makes equipment meaningful. `+energyRegen` and `−energyCost` are as valuable as raw
  speed, which gives the item table more than one axis.
- It makes the game **verifiable on-chain**. Energy is a pure function of elapsed time,
  so a program can compute the maximum that could have accrued and reject anything above
  it. See [SECURITY.md](SECURITY.md).

Yield is `1 × (1 + yieldBonus%)`, returned as a float. The client accumulates the
fractional part, so `+37%` reliably produces an extra unit roughly every third block
rather than being rounded away. No RNG, nothing lost.

### The strata

| Band | Depth | Base block | Hardness | Ores |
| --- | --- | --- | --- | --- |
| Topsoil | 62 → 58 | Dirt | 0.5 | — |
| Upper Stone | 57 → 34 | Stone | 1.0 | Coal, Iron, Copper |
| Deepslate | 33 → 16 | Deepslate | 1.9 | + Silver, Titanium |
| Basalt Margin | 15 → 4 | Basalt | 3.1 | Titanium, Crystal, Voidstone |
| Bedrock | 3 → 0 | Bedrock | ∞ | — |

Caves are carved where two independent noise fields are both near zero, which produces
long connected tunnels rather than spherical bubbles. They matter because they expose ore
faces with no digging at all — that is what makes the first descent feel like exploring
instead of grinding.

The claim's edges are an exposed cross-section of all five bands. That is deliberate: it
tells a new player at a glance what is under their feet and why they should go down.

### The resource ladder

| Raw | Value | → Refined | Value | Ratio |
| --- | ---: | --- | ---: | ---: |
| Coal | 1 | — | — | — |
| Iron Ore | 3 | Iron Ingot | 38 | 4.2× |
| Copper Ore | 4 | Copper Ingot | 50 | 4.2× |
| Silver Ore | 9 | Silver Ingot | 112 | 4.1× |
| Titanium Ore | 22 | Titanium Plate | 265 | 4.0× |
| Raw Crystal | 55 | Focused Crystal | 650 | 3.9× |
| Voidstone | 140 | Void Core | 1,650 | 3.9× |

Each recipe consumes three ore plus coal. **Selling raw ore is always the worst thing you
can do with it** — that single fact is what gives the Smelter a reason to exist and makes
"build infrastructure" strictly better than "sell everything". A city builder without that
property collapses into a click farm.

`economy.test.ts` asserts the ratio stays above 2.5× for every recipe, so the numbers
can't quietly drift away from the design.

---

## The city

Seven buildings. The binding constraint is **workers**, not money.

| Building | Size | Crew | Power | Does |
| --- | --- | ---: | ---: | --- |
| Extractor | 5×5 | 2 | −3 | Bores downward forever, yielding whatever stratum it has reached |
| Smelter | 5×5 | 3 | −4 | Runs refining recipes continuously |
| Generator | 5×5 | 2 | **+14** | Burns coal into the power everything else needs |
| Silo | 3×3 | 1 | −1 | Raises the storage ceiling |
| Habitat | 5×5 | **−4** | −2 | The only source of workers |
| Market Hub | 7×7 | 4 | −3 | Unlocks listing; each level cuts 20bps off market fees |
| Assay Lab | 5×5 | 3 | −5 | +3 luck and +5% refine speed per level |

**Why workers and not money.** Money is a pacing gate — it slows you down but never makes
you choose. Workers make you choose: Habitats are the only supply, every other building
consumes them, so expanding always means deciding what you are willing to house. That is
the actual puzzle in the city layer.

**Why power is soft.** Running a deficit doesn't break anything; it scales all production
down proportionally, floored at 15%. Failing a city builder because you misjudged a
generator is not fun, and the punishment for under-building is already that you produce
less.

### Extractors and the bore

An Extractor descends `0.005 × level` blocks per second and yields the ore mix of
whatever band its bore currently sits in. At level 1 that is roughly two hours to reach
bedrock; at level 5, about twenty minutes.

This is the best mechanic in the city layer because it makes *time* a resource with a
direction. An extractor left running gets better on its own, which gives a reason to come
back tomorrow that isn't a daily-login bribe.

---

## Loot and crates

### Rarity

Common → Uncommon → Rare → Epic → Legendary → Mythic. Rarity multiplies base stat ranges
by ×1.0 / ×1.45 / ×2.1 / ×3.0 / ×4.3 / ×6.2.

### Items

Five slots, four archetypes each, twenty items total. Every archetype rolls a different
combination of stats, and several carry a real drawback:

- **Pick** — hand-mining speed. *Corebreaker* rolls +11–19% speed but **+3–7% energy cost**.
- **Drill Core** — Extractor output. *Void Auger* is the fastest and the hungriest.
- **Power Cell** — energy pool and regeneration. *Dense Cell* holds more, refills slower.
- **Scanner** — luck and yield. Also drives the "ore nearby" HUD readout.
- **Exo-Frame** — energy efficiency. *Null Rig* is the strongest reduction in the game.

**Quality** is a separate axis from rarity: it measures how close a specific roll landed
to the top of its range, 0–100%. A 12% Legendary really is worse than a 96% Epic, and the
item card makes that visible — otherwise players trade badly and feel cheated.

### Crates

| Crate | Price | Draws | Common | Rare | Legendary | Mythic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Supply Crate | 250 | 3 | 62% | 8.2% | 0.27% | 0.03% |
| Prospector Case | 1,200 | 4 | 38% | 16.5% | 0.9% | 0.1% |
| Deep Core Vault | 5,000 | 5 | 12% | 35% | 4% | 0.5% |

The Deep Core Vault's final draw is **guaranteed Rare or better** — enforced by a separate
table, and asserted in the test suite because it is a promise made on the marketing page.

Weights are in parts-per-million and every table sums to exactly 1,000,000. Equipped
Scanner luck shifts weight out of Common into everything above it, proportional to tier,
capped at 60. The crate panel shows the luck-adjusted table, not the base one — quoting
base odds while a player's Scanner is changing them would be a lie of omission.

Opening is two steps, and the UI exposes both rather than hiding them behind one button,
because the two-step flow *is* the fairness argument. See [SECURITY.md](SECURITY.md).

---

## Marketplace

Any item can be **salvaged** for a guaranteed payout, which puts a hard floor under
everything. Listing it instead is a bet that someone values the roll more than the scrap —
and because stat ranges are published, they can check.

Every listing shows its price as a **multiple of salvage value**. "4,200 STRATA" tells a
player nothing; "1.4× salvage" tells them whether it's a deal. That single piece of
framing is the difference between a market people can use and a wall of numbers.

Fees are 250bps, reduced 20bps per Market Hub level to a floor of 50bps. 40% of every fee
is burned; the rest funds the treasury.

The simulated order book drifts: underpriced listings sell first, new ones appear, roughly
one turnover per 40 seconds of elapsed time. Every synthetic row is labelled as such.

---

## Progression

**XP** comes from mining (hardness × 2 per block), selling (proceeds ÷ 12), settling city
output, and opening crates. `xpToNext(level) = floor(120 × level^1.55)`.

Levels give a small flat bonus (+1.5% mining speed, +5 max energy each) so progress is
visible even through a drop drought, and they gate buildings.

| Phase | Level | Goal | Milestone |
| --- | ---: | --- | --- |
| **Early** | 1–3 | Learn that refining beats selling | First Generator + Habitat; first Smelter at level 2 |
| **Mid** | 3–8 | Build a city that runs without you | Market Hub at level 3; extractors reaching Deepslate |
| **Late** | 8–20 | Reach the Basalt Margin | Assay Lab at level 4; first Focused Crystal; first Legendary |
| **End** | 20+ | Void Cores and the market | Level 5 Smelter; extractors at bedrock; trading rather than mining for income |

The intended shift across those phases is from **acting** to **arranging**: early on you
mine because it's the only income you have; by the late game your hands are for
prospecting and your city is for earning.

---

## What is deliberately not here

- **No energy purchases.** Energy is the design constraint. Selling a way around it would
  delete the game.
- **No daily login rewards.** Extractors already give a reason to come back, and it's a
  reason inside the fiction rather than a bribe outside it.
- **No competitive pressure on the claim.** Your ground is yours. Nobody can mine it,
  raid it, or take it. The competition is the marketplace, where it belongs.
- **No token.** See [ONCHAIN.md](ONCHAIN.md) for the position on that and why it is the
  last thing to add rather than the first.
