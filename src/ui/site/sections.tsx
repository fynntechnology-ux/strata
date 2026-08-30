"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { PACK_LIST, tableAsPercentages } from "@/sim/packs";
import { RARITY_META, type Rarity } from "@/sim/types";
import { RESOURCE_DEFS } from "@/sim/resources";
import { ARCHETYPE_BY_KEY } from "@/sim/items";
import { seedMarket } from "@/onchain/mock/synthetic";
import { formatToken } from "@/onchain/types";
import { num } from "@/lib/format";
import {
  Button,
  Card,
  Chip,
  Panel,
  RarityBadge,
  RarityEdge,
  cn,
} from "@/ui/primitives";
import {
  IconCrate,
  IconCube,
  IconExtractor,
  IconMarket,
  IconPick,
  IconSmelter,
  IconStack,
  IconTag,
  SLOT_ICONS,
} from "@/ui/icons";

const HeroDiorama = dynamic(() => import("./HeroDiorama"), {
  ssr: false,
  loading: () => <div className="h-full w-full" />,
});

/* ==========================================================================
   Shared
   ========================================================================== */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="h-px w-6 bg-amber" />
      <span className="font-display text-[11px] uppercase tracking-[0.2em] text-amber">
        {children}
      </span>
    </div>
  );
}

function Section({
  id,
  children,
  className,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 px-5 py-20 sm:py-28", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

/* ==========================================================================
   Hero
   ========================================================================== */

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-16">
      <div className="vx-grid pointer-events-none absolute inset-0 opacity-[0.16]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--color-amber)_13%,transparent),transparent_62%)]" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-12 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:pb-24 lg:pt-20">
        <div className="animate-rise">
          <div className="mb-6 inline-flex items-center gap-2 border border-edge bg-crust px-3 py-1.5">
            <span className="h-1.5 w-1.5 bg-cyan" style={{ animation: "vx-pulse 2s infinite" }} />
            <span className="text-[11px] tracking-wide text-body">
              Playable now · simulated economy · no wallet required
            </span>
          </div>

          <h1 className="font-display text-[2.6rem] leading-[1.03] tracking-[-0.03em] text-hi sm:text-6xl lg:text-[4.1rem]">
            Dig a city out
            <br />
            of the <span className="text-molten">ground</span>.
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-body sm:text-lg">
            STRATA is a browser voxel mining sim. Sink a shaft through layered rock, refine what
            you haul up, and build the city that keeps digging while you&rsquo;re gone.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/play">
              <Button variant="primary" size="lg" icon={<IconPick size={16} />}>
                Play the demo
              </Button>
            </Link>
            <Link href="#how">
              <Button variant="secondary" size="lg">
                How it works
              </Button>
            </Link>
          </div>

          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-px border border-edge bg-edge">
            {[
              { label: "Strata layers", value: "5" },
              { label: "Ore types", value: "7" },
              { label: "Voxels per claim", value: "614K" },
            ].map((stat) => (
              <div key={stat.label} className="bg-crust px-4 py-3.5">
                <dt className="text-[10px] uppercase tracking-[0.13em] text-mute">{stat.label}</dt>
                <dd className="tnum mt-1 text-xl font-semibold text-hi">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative h-[340px] sm:h-[420px] lg:h-[540px]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,color-mix(in_oklab,var(--color-amber)_11%,transparent),transparent_60%)]" />
          <HeroDiorama className="h-full w-full" />
        </div>
      </div>
    </section>
  );
}

/* ==========================================================================
   How it works
   ========================================================================== */

const STEPS = [
  {
    icon: IconCube,
    title: "Claim your ground",
    body:
      "Your wallet address seeds the terrain, so the ore under your feet is yours and nobody else has the same layout. No wallet? A demo claim works identically.",
  },
  {
    icon: IconPick,
    title: "Mine by hand",
    body:
      "Click into the rock and it breaks. Energy is the limit, and energy only comes back with time — so the question is never how fast you can click, it's what you spend it on.",
  },
  {
    icon: IconExtractor,
    title: "Build the city",
    body:
      "Extractors bore downward while you're away and reach richer strata the longer they run. Smelters quadruple what ore is worth. Generators keep both alive.",
  },
  {
    icon: IconTag,
    title: "Trade the results",
    body:
      "Open supply crates for equipment, salvage what you don't need, and list the rest on an open marketplace where other players set the price.",
  },
];

export function HowItWorks() {
  return (
    <Section id="how" className="border-t border-edge bg-deep">
      <SectionLabel>How it works</SectionLabel>
      <h2 className="max-w-2xl text-3xl sm:text-4xl">Four things to understand, then you&rsquo;re playing.</h2>

      <div className="mt-12 grid gap-px border border-edge bg-edge sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <div key={step.title} className="group bg-crust p-6 transition-colors hover:bg-panel sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center border border-amber/35 bg-amber/10 text-amber">
                <step.icon size={17} />
              </span>
              <span className="tnum text-xs text-faint">0{i + 1}</span>
            </div>
            <h3 className="mt-4 text-lg">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mute">{step.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ==========================================================================
   The loop
   ========================================================================== */

export function EconomicLoop() {
  return (
    <Section id="loop">
      <SectionLabel>The loop</SectionLabel>
      <h2 className="max-w-2xl text-3xl sm:text-4xl">Everything feeds the next thing.</h2>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-body">
        Raw ore is the worst thing you can sell. Refining roughly quadruples its value, and
        refining needs a Smelter, which needs power, which needs coal, which needs mining. The
        economy is a closed loop with real sinks &mdash; currency leaves it every time you open
        a crate, place a building or pay a market fee.
      </p>

      <div className="mt-12 overflow-x-auto">
        <svg viewBox="0 0 900 300" className="h-auto w-full min-w-[680px]" role="img" aria-label="Economic loop diagram">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--color-edge-hi)" />
            </marker>
            <marker id="arrowAmber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--color-amber)" />
            </marker>
          </defs>

          {[
            { x: 20, y: 108, label: "Mine", sub: "energy → ore", accent: "var(--color-amber)" },
            { x: 200, y: 108, label: "Refine", sub: "ore → ingots", accent: "var(--color-ember)" },
            { x: 380, y: 108, label: "Sell", sub: "ingots → STRATA", accent: "var(--color-good)" },
            { x: 560, y: 30, label: "Build", sub: "city output ↑", accent: "var(--color-cyan)" },
            { x: 560, y: 186, label: "Crates", sub: "better gear", accent: "var(--color-r-legendary)" },
            { x: 740, y: 108, label: "Market", sub: "player pricing", accent: "var(--color-violet)" },
          ].map((node) => (
            <g key={node.label}>
              <rect
                x={node.x}
                y={node.y}
                width="140"
                height="72"
                fill="var(--color-crust)"
                stroke={node.accent}
                strokeOpacity="0.45"
              />
              <rect x={node.x} y={node.y} width="4" height="72" fill={node.accent} />
              <text x={node.x + 20} y={node.y + 30} fill="var(--color-hi)" fontSize="16" fontFamily="var(--font-display)" fontWeight="600">
                {node.label}
              </text>
              <text x={node.x + 20} y={node.y + 51} fill="var(--color-mute)" fontSize="12">
                {node.sub}
              </text>
            </g>
          ))}

          <path d="M160 144 L196 144" stroke="var(--color-edge-hi)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <path d="M340 144 L376 144" stroke="var(--color-edge-hi)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <path d="M520 144 L540 144 L540 66 L556 66" stroke="var(--color-edge-hi)" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
          <path d="M520 144 L540 144 L540 222 L556 222" stroke="var(--color-edge-hi)" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
          <path d="M700 66 L720 66 L720 130 L736 130" stroke="var(--color-edge-hi)" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
          <path d="M700 222 L720 222 L720 160 L736 160" stroke="var(--color-edge-hi)" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />

          {/* The return leg: better gear and a bigger city make mining faster. */}
          <path
            d="M810 186 L810 268 L90 268 L90 184"
            stroke="var(--color-amber)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            fill="none"
            markerEnd="url(#arrowAmber)"
          />
          <text x="400" y="288" fill="var(--color-amber)" fontSize="12" textAnchor="middle">
            better gear and a bigger city → more output per unit of energy
          </text>
        </svg>
      </div>
    </Section>
  );
}

/* ==========================================================================
   Economy / honesty section
   ========================================================================== */

export function EconomySection() {
  return (
    <Section id="economy" className="border-y border-edge bg-deep">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <SectionLabel>The currency</SectionLabel>
          <h2 className="text-3xl sm:text-4xl">
            The economy is simulated. Here&rsquo;s exactly what that means.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-body">
            STRATA balances, items and listings live in your browser. There is no token, no
            mint, and nothing to buy. Everything you earn in the game is worth precisely what a
            high score is worth.
          </p>
          <p className="mt-4 text-base leading-relaxed text-body">
            The chain layer is real code, though. Every action goes through one interface with
            two implementations &mdash; a local simulator and a Solana client with real program
            addresses, real instruction encoding and real wallet support. Switching between them
            is an environment variable, not a rewrite.
          </p>

          <div className="mt-8 flex flex-wrap gap-2">
            <Chip color="var(--color-cyan)">Wallet Standard</Chip>
            <Chip color="var(--color-cyan)">Anchor programs</Chip>
            <Chip color="var(--color-cyan)">Commit-reveal randomness</Chip>
            <Chip color="var(--color-cyan)">Escrowed listings</Chip>
          </div>
        </div>

        <div className="space-y-px border border-edge bg-edge">
          {[
            {
              state: "live",
              title: "Simulated chain adapter",
              body: "Balances, inventory, crates, marketplace and staking, all running locally with realistic latency and failure modes.",
            },
            {
              state: "live",
              title: "Wallet connection",
              body: "Phantom, Solflare and anything else speaking Wallet Standard. Read-only — your address seeds your claim; nothing is ever signed.",
            },
            {
              state: "live",
              title: "Verifiable crate odds",
              body: "Every reveal publishes its seed. Drop tables are public and the roll can be recomputed by anyone from the two transactions.",
            },
            {
              state: "wired",
              title: "Anchor programs",
              body: "Config, packs and marketplace programs written, with PDAs and instruction encoding already matched by the client. Not deployed.",
            },
            {
              state: "later",
              title: "A token",
              body: "Deliberately not launched. A game economy should be worth playing before it is worth anything else.",
            },
          ].map((row) => (
            <div key={row.title} className="bg-crust p-5">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5",
                    row.state === "live"
                      ? "bg-good"
                      : row.state === "wired"
                        ? "bg-warn"
                        : "bg-faint"
                  )}
                />
                <span
                  className={cn(
                    "font-display text-[10px] uppercase tracking-[0.15em]",
                    row.state === "live"
                      ? "text-good"
                      : row.state === "wired"
                        ? "text-warn"
                        : "text-faint"
                  )}
                >
                  {row.state === "live" ? "Working" : row.state === "wired" ? "Written, not deployed" : "Not built"}
                </span>
              </div>
              <h3 className="mt-2 text-base">{row.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-mute">{row.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ==========================================================================
   Crates
   ========================================================================== */

export function CratesSection() {
  const [selected, setSelected] = useState(1);
  const pack = PACK_LIST[selected];
  const odds = tableAsPercentages(pack.table);

  return (
    <Section id="crates">
      <SectionLabel>Supply crates</SectionLabel>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="max-w-2xl text-3xl sm:text-4xl">Published odds, verifiable rolls.</h2>
        <p className="max-w-md text-sm leading-relaxed text-mute">
          Every table below is the same constant the game reads at runtime. Nothing is hidden,
          and every reveal ships the seed it was computed from.
        </p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {PACK_LIST.map((definition, i) => (
          <Card
            key={definition.kind}
            interactive
            onClick={() => setSelected(i)}
            className={cn(
              "relative overflow-hidden p-6",
              selected === i && "border-amber/60 bg-panel"
            )}
          >
            <span
              className="absolute inset-x-0 top-0 h-[3px]"
              style={{ background: definition.accent }}
            />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg">{definition.name}</h3>
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.13em] text-mute">
                  {definition.tagline}
                </p>
              </div>
              <IconCrate size={26} style={{ color: definition.accent }} />
            </div>

            <p className="mt-4 min-h-[60px] text-sm leading-relaxed text-mute">
              {definition.description}
            </p>

            <div className="mt-5 flex items-end justify-between border-t border-edge pt-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.13em] text-mute">Price</div>
                <div className="tnum mt-0.5 text-xl font-semibold text-hi">
                  {num(definition.priceTokens)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.13em] text-mute">Draws</div>
                <div className="tnum mt-0.5 text-xl font-semibold text-hi">{definition.draws}</div>
              </div>
            </div>

            {definition.floorLabel && (
              <div className="mt-3 border border-r-legendary/40 bg-r-legendary/10 px-2.5 py-1.5 text-[11px] text-r-legendary">
                {definition.floorLabel}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Panel className="mt-6 p-6" ticks>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-display text-sm uppercase tracking-[0.11em] text-hi">
            {pack.name} — rarity table
          </h3>
          <span className="text-xs text-mute">
            Weights are parts per million and sum to exactly 1,000,000
          </span>
        </div>

        <div className="mt-5 space-y-2.5">
          {odds.map((row) => (
            <div key={row.rarity} className="flex items-center gap-4">
              <span
                className="w-24 shrink-0 font-display text-[11px] uppercase tracking-[0.1em]"
                style={{ color: RARITY_META[row.rarity as Rarity].color }}
              >
                {RARITY_META[row.rarity as Rarity].label}
              </span>
              <div className="h-2.5 flex-1 bg-raised">
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    // Square-root scale: a linear bar makes a 0.03% mythic
                    // chance literally invisible next to a 62% common.
                    width: `${Math.sqrt(row.pct / 100) * 100}%`,
                    background: RARITY_META[row.rarity as Rarity].color,
                  }}
                />
              </div>
              <span className="tnum w-20 shrink-0 text-right text-xs text-body">
                {row.pct < 1 ? row.pct.toFixed(2) : row.pct.toFixed(1)}%
              </span>
              <span className="tnum hidden w-24 shrink-0 text-right text-[11px] text-faint sm:block">
                {num(row.ppm)} ppm
              </span>
            </div>
          ))}
        </div>

        <p className="mt-5 border-t border-edge pt-4 text-xs leading-relaxed text-mute">
          Bars use a square-root scale so the rare end stays visible. An equipped Scanner shifts
          weight out of Common into everything above it, up to a hard cap of 60 luck.
        </p>
      </Panel>
    </Section>
  );
}

/* ==========================================================================
   Marketplace preview
   ========================================================================== */

// Fixed timestamp keeps this deterministic between server and client render.
const PREVIEW_LISTINGS = seedMarket(60, 1_760_000_000_000)
  .filter((listing) => RARITY_META[listing.item.rarity].tier >= 2)
  .slice(0, 6);

export function MarketSection() {
  return (
    <Section id="market" className="border-t border-edge bg-deep">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionLabel>Marketplace</SectionLabel>
          <h2 className="max-w-2xl text-3xl sm:text-4xl">
            Salvage sets the floor. Players set the price.
          </h2>
        </div>
        <Link href="/play">
          <Button variant="outline" icon={<IconMarket size={16} />}>
            Open the market
          </Button>
        </Link>
      </div>

      <p className="mt-5 max-w-2xl text-base leading-relaxed text-body">
        Any item can be salvaged for a guaranteed payout, which puts a hard floor under
        everything. Listing it instead is a bet that someone values the roll more than the
        scrap &mdash; and with published stat ranges, they can check.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PREVIEW_LISTINGS.map((listing) => {
          const archetype = ARCHETYPE_BY_KEY.get(listing.item.archetype);
          const Icon = SLOT_ICONS[listing.item.slot];
          const meta = RARITY_META[listing.item.rarity];

          return (
            <Card key={listing.id} className="relative overflow-hidden p-5">
              <RarityEdge rarity={listing.item.rarity} />
              <div className="flex items-start justify-between gap-3 pl-2">
                <div className="min-w-0">
                  <h3 className="truncate text-base">{archetype?.name ?? "Unknown"}</h3>
                  <div className="mt-1.5 flex items-center gap-2">
                    <RarityBadge rarity={listing.item.rarity} size="sm" />
                    <span className="tnum text-[11px] text-mute">
                      {listing.item.quality}% roll
                    </span>
                  </div>
                </div>
                <Icon size={24} style={{ color: meta.color }} />
              </div>

              <ul className="mt-4 space-y-1 pl-2">
                {Object.entries(listing.item.stats).map(([key, value]) => (
                  <li key={key} className="tnum text-[11px] text-body">
                    {(value ?? 0) > 0 ? "+" : ""}
                    {value}
                    {key === "energyMax" ? "" : "%"}{" "}
                    <span className="text-mute">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-end justify-between border-t border-edge pt-3 pl-2">
                <span className="tnum text-lg font-semibold text-amber">
                  {formatToken(listing.price)}
                </span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-faint">
                  simulated
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

/* ==========================================================================
   Resources
   ========================================================================== */

export function ResourceLadder() {
  const raw = Object.values(RESOURCE_DEFS).filter((r) => !r.refined);
  const refined = Object.values(RESOURCE_DEFS).filter((r) => r.refined);

  return (
    <Section>
      <SectionLabel>What&rsquo;s down there</SectionLabel>
      <h2 className="max-w-2xl text-3xl sm:text-4xl">Depth gates value, not grind.</h2>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-body">
        You don&rsquo;t reach titanium by mining more iron. You reach it by going deeper, which
        costs harder tools and more energy per swing. Every tier roughly triples in value, and
        refining it multiplies that again.
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {[
          { title: "Raw ore", icon: IconStack, list: raw },
          { title: "Refined", icon: IconSmelter, list: refined },
        ].map((group) => (
          <Panel key={group.title} className="overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-edge px-5 py-3.5">
              <group.icon size={16} className="text-amber" />
              <h3 className="font-display text-[12px] uppercase tracking-[0.12em] text-hi">
                {group.title}
              </h3>
            </div>
            <ul>
              {group.list.map((resource) => (
                <li
                  key={resource.kind}
                  className="flex items-center gap-3 border-b border-edge/60 px-5 py-3 last:border-0"
                >
                  <span
                    className="h-4 w-4 shrink-0 border border-white/10"
                    style={{ background: resource.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-hi">{resource.label}</div>
                    <div className="truncate text-[11px] text-mute">{resource.description}</div>
                  </div>
                  <span className="tnum shrink-0 text-sm text-amber">
                    {num(resource.baseValue)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </Section>
  );
}

/* ==========================================================================
   Roadmap
   ========================================================================== */

const PHASES = [
  {
    phase: "Phase 1",
    title: "Playable claim",
    state: "done",
    items: [
      "Voxel engine with ambient occlusion and strata generation",
      "Hand mining, energy budget, resource yields",
      "Simulated chain adapter with full transaction semantics",
      "Landing site and design system",
    ],
  },
  {
    phase: "Phase 2",
    title: "City and economy",
    state: "done",
    items: [
      "Seven building types with worker and power constraints",
      "Passive extraction with descending bores",
      "Smelting recipes and the refine multiplier",
      "Contracts, levels and progression gates",
    ],
  },
  {
    phase: "Phase 3",
    title: "Crates and market",
    state: "active",
    items: [
      "Commit-reveal crate opening with published odds",
      "Item rolls, salvage floor, equipment stats",
      "Marketplace listings, offers and fees",
      "Economy tuning against real play data",
    ],
  },
  {
    phase: "Phase 4",
    title: "On-chain",
    state: "next",
    items: [
      "Deploy Anchor programs to devnet",
      "Swap the adapter, keep the UI",
      "Indexer for listings and leaderboards",
      "Third-party review before anything touches mainnet",
    ],
  },
];

export function Roadmap() {
  return (
    <Section id="roadmap" className="border-t border-edge bg-deep">
      <SectionLabel>Roadmap</SectionLabel>
      <h2 className="max-w-2xl text-3xl sm:text-4xl">Built in order of what makes it a game.</h2>

      <div className="mt-12 grid gap-px border border-edge bg-edge lg:grid-cols-4">
        {PHASES.map((phase) => (
          <div key={phase.phase} className="bg-crust p-6">
            <div className="flex items-center justify-between">
              <span className="font-display text-[11px] uppercase tracking-[0.15em] text-mute">
                {phase.phase}
              </span>
              <span
                className={cn(
                  "border px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.12em]",
                  phase.state === "done" && "border-good/45 bg-good/10 text-good",
                  phase.state === "active" && "border-amber/50 bg-amber/12 text-amber",
                  phase.state === "next" && "border-edge-hi text-faint"
                )}
              >
                {phase.state === "done" ? "Shipped" : phase.state === "active" ? "In progress" : "Planned"}
              </span>
            </div>
            <h3 className="mt-3 text-lg">{phase.title}</h3>
            <ul className="mt-4 space-y-2.5">
              {phase.items.map((item) => (
                <li key={item} className="flex gap-2.5 text-[13px] leading-relaxed text-mute">
                  <span
                    className={cn(
                      "mt-1.5 h-1 w-1 shrink-0",
                      phase.state === "done" ? "bg-good" : "bg-faint"
                    )}
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ==========================================================================
   FAQ
   ========================================================================== */

const FAQS = [
  {
    q: "Do I need a wallet or any crypto to play?",
    a: "No. The demo claim needs nothing at all — click Play and you're in. Connecting a wallet is optional and read-only: it takes your address to seed your terrain so the same claim comes back on any device. Nothing is ever signed and no transaction is ever requested.",
  },
  {
    q: "Is there a token? Can I buy one?",
    a: "No, and no. The STRATA balance in the game is a number in your browser's local storage with no monetary value and no way to cash out. No token has been minted or offered for sale. If that ever changes it will be announced here in plain language, with the economics published first.",
  },
  {
    q: "Why build the chain layer at all if nothing is on-chain?",
    a: "Because retrofitting is where these projects usually fail. Doing it up front forces the hard parts early: idempotent settlement, batched writes, verifiable randomness, and a client that already handles slow and failing transactions. The simulator implements the same interface, so the switch is configuration rather than a rewrite.",
  },
  {
    q: "How do I know the crate odds are real?",
    a: "The drop tables are constants in the repository and the same ones the game reads at runtime — they're printed on this page directly from that source. Each opening is a two-step commit and reveal: you lock in a secret before any entropy exists, then publish it. Anyone holding both steps can recompute the exact result.",
  },
  {
    q: "Can I cheat by editing my local storage?",
    a: "In simulated mode, obviously — it's your browser and there's nothing at stake. The design still assumes an adversarial client: hand-mined yield is bounded by an energy budget that is a pure function of elapsed time, so even a fully patched client can choose what to claim but not how much.",
  },
  {
    q: "What are the risks I should know about?",
    a: "Today the honest answer is 'you might waste an afternoon'. Nothing is at stake because nothing has value. If an on-chain version ships, the real risks are the usual ones: smart contract bugs, key loss, and the fact that game items have no guaranteed value. None of this is financial advice.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section id="faq">
      <SectionLabel>FAQ</SectionLabel>
      <h2 className="max-w-2xl text-3xl sm:text-4xl">Questions worth asking.</h2>

      <div className="mt-10 border border-edge">
        {FAQS.map((item, i) => (
          <div key={item.q} className="border-b border-edge last:border-0">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              className="flex w-full items-center justify-between gap-4 bg-crust px-5 py-4 text-left transition-colors hover:bg-panel"
            >
              <span className="font-display text-[15px] text-hi">{item.q}</span>
              <span
                className={cn(
                  "shrink-0 text-amber transition-transform duration-200",
                  open === i && "rotate-45"
                )}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </button>
            {open === i && (
              <div className="bg-deep px-5 pb-5 pt-1">
                <p className="max-w-3xl text-sm leading-relaxed text-body">{item.a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ==========================================================================
   Final CTA
   ========================================================================== */

export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-edge px-5 py-24">
      <div className="vx-grid pointer-events-none absolute inset-0 opacity-[0.13]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,color-mix(in_oklab,var(--color-amber)_16%,transparent),transparent_60%)]" />
      <div className="relative mx-auto max-w-2xl text-center">
        <h2 className="text-3xl sm:text-5xl">There&rsquo;s ore under there.</h2>
        <p className="mt-5 text-base leading-relaxed text-body">
          No sign-up, no wallet, no download. The claim generates in about two seconds and the
          first block breaks a second after that.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/play">
            <Button variant="primary" size="lg" icon={<IconPick size={16} />}>
              Start digging
            </Button>
          </Link>
          <Link href="#economy">
            <Button variant="secondary" size="lg">
              Read the honest bit first
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
