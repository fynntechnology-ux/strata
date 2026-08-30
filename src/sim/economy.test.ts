import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { PPM, rollFromSeed, weightedPick } from "@/lib/rng";
import { PACK_DEFS, applyLuck, openPack } from "./packs";
import { RECIPES, RESOURCE_DEFS, bagCovers, bagSubtract, bagTotal } from "./resources";
import {
  BASE,
  deriveCityStats,
  derivePlayerStats,
  levelFromXp,
  marketFeeSplit,
  miningEnergyCost,
  miningTimeMs,
  simulateProduction,
  xpToNext,
} from "./economy";
import { RARITIES, type Rarity, type ResourceKind } from "./types";
import { salvageValue } from "./items";
import { BUILDING_DEFS, BUILDING_LIST, buildingCost } from "./buildings";

const seed = (text: string) => sha256(new TextEncoder().encode(text));

/* ==========================================================================
   Randomness — the properties that make published odds mean anything
   ========================================================================== */

describe("pack randomness", () => {
  it("reproduces the same contents from the same seed", () => {
    const a = openPack("deepcore", seed("determinism"), 0);
    const b = openPack("deepcore", seed("determinism"), 0);

    expect(a.items.map((i) => [i.archetype.key, i.rarity, i.quality])).toEqual(
      b.items.map((i) => [i.archetype.key, i.rarity, i.quality])
    );
    expect(a.resources).toEqual(b.resources);
    expect(a.bonusTokens).toBe(b.bonusTokens);
  });

  it("produces different contents from different seeds", () => {
    const a = openPack("prospector", seed("one"), 0);
    const b = openPack("prospector", seed("two"), 0);
    expect(a.items.map((i) => i.archetype.key).join()).not.toBe(
      b.items.map((i) => i.archetype.key).join()
    );
  });

  it("honours the guaranteed floor on a Deep Core Vault's final draw", () => {
    // The floor is a promise made on the marketing page, so check it hard
    // rather than trusting the table to stay correct through later edits.
    for (let i = 0; i < 400; i++) {
      const outcome = openPack("deepcore", seed(`floor-${i}`), 0);
      const final = outcome.items[outcome.items.length - 1];
      expect(RARITIES.indexOf(final.rarity)).toBeGreaterThanOrEqual(RARITIES.indexOf("rare"));
    }
  });

  it("converges on the declared odds over many draws", () => {
    const table = PACK_DEFS.supply.table;
    const counts = new Map<Rarity, number>();
    const SAMPLES = 60_000;

    for (let i = 0; i < SAMPLES; i++) {
      const rarity = weightedPick(table, rollFromSeed(seed("odds"), i));
      counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
    }

    for (const entry of table) {
      const observed = (counts.get(entry.value) ?? 0) / SAMPLES;
      const expected = entry.ppm / PPM;
      // Generous tolerance: this checks the sampler isn't broken, not that it
      // passes a statistics exam. A wrong table is off by orders of magnitude.
      expect(
        Math.abs(observed - expected),
        `${entry.value}: saw ${observed}, expected ${expected}`
      ).toBeLessThan(Math.max(0.004, expected * 0.12));
    }
  });

  it("keeps luck-adjusted tables summing to exactly one million ppm", () => {
    for (let luck = 0; luck <= 60; luck++) {
      for (const pack of Object.values(PACK_DEFS)) {
        const adjusted = applyLuck(pack.table, luck);
        const total = adjusted.reduce((n, e) => n + e.ppm, 0);
        expect(total, `luck ${luck} on ${pack.kind}`).toBe(PPM);
        expect(adjusted.every((e) => e.ppm >= 0)).toBe(true);
      }
    }
  });

  it("makes rare outcomes likelier as luck rises, never rarer", () => {
    const base = applyLuck(PACK_DEFS.supply.table, 0);
    const lucky = applyLuck(PACK_DEFS.supply.table, 60);
    const ppmOf = (table: typeof base, rarity: Rarity) =>
      table.find((e) => e.value === rarity)?.ppm ?? 0;

    expect(ppmOf(lucky, "common")).toBeLessThan(ppmOf(base, "common"));
    for (const rarity of RARITIES.filter((r) => r !== "common")) {
      expect(ppmOf(lucky, rarity)).toBeGreaterThanOrEqual(ppmOf(base, rarity));
    }
  });
});

/* ==========================================================================
   Economy shape
   ========================================================================== */

describe("resource ladder", () => {
  it("makes refining worth substantially more than selling raw", () => {
    for (const recipe of RECIPES) {
      const rawValue = RESOURCE_DEFS[recipe.input].baseValue * recipe.inputQty;
      const refinedValue = RESOURCE_DEFS[recipe.output].baseValue * recipe.outputQty;
      expect(
        refinedValue / rawValue,
        `${recipe.output} should beat selling ${recipe.input} raw`
      ).toBeGreaterThan(2.5);
    }
  });

  it("increases value with depth", () => {
    const tiers = ["coal", "iron", "silver", "titanium", "crystal", "voidstone"] as const;
    for (let i = 1; i < tiers.length; i++) {
      expect(RESOURCE_DEFS[tiers[i]].baseValue).toBeGreaterThan(
        RESOURCE_DEFS[tiers[i - 1]].baseValue
      );
    }
  });
});

describe("bag arithmetic", () => {
  it("refuses to spend what isn't there", () => {
    expect(bagCovers({ iron: 3 }, { iron: 4 })).toBe(false);
    expect(bagCovers({ iron: 4 }, { iron: 4 })).toBe(true);
    expect(bagCovers({}, { coal: 1 })).toBe(false);
  });

  it("removes keys that reach zero rather than leaving them at 0", () => {
    const bag = { iron: 3, coal: 5 };
    bagSubtract(bag, { iron: 3 });
    expect(bag).not.toHaveProperty("iron");
    expect(bagTotal(bag)).toBe(5);
  });
});

/* ==========================================================================
   Production
   ========================================================================== */

describe("passive production", () => {
  const buildings = [
    { id: "g1", kind: "generator" as const, level: 2 },
    { id: "h1", kind: "habitat" as const, level: 2 },
    { id: "e1", kind: "extractor" as const, level: 2, boreDepth: 40 },
    { id: "s1", kind: "smelter" as const, level: 2 },
  ];

  const city = deriveCityStats(buildings);
  const stats = derivePlayerStats({}, city, 5);

  it("produces nothing over zero elapsed time", () => {
    const result = simulateProduction({
      buildings,
      resources: { coal: 500, iron: 500 },
      city,
      stats,
      elapsedSeconds: 0,
    });
    expect(bagTotal(result.produced)).toBe(0);
  });

  it("scales output with elapsed time", () => {
    // Well under the storage cap, or the clamp hides the effect entirely.
    const stock = { coal: 300, iron: 300 };
    const short = simulateProduction({
      buildings,
      resources: stock,
      city,
      stats,
      elapsedSeconds: 60,
    });
    const long = simulateProduction({
      buildings,
      resources: stock,
      city,
      stats,
      elapsedSeconds: 600,
    });
    expect(bagTotal(short.produced)).toBeGreaterThan(0);
    expect(bagTotal(long.produced)).toBeGreaterThan(bagTotal(short.produced));
  });

  it("never produces past the storage cap", () => {
    const stock = { coal: 300, iron: 300 };
    const result = simulateProduction({
      buildings,
      resources: stock,
      city,
      stats,
      elapsedSeconds: 86_400 * 7,
    });

    expect(result.storageFull).toBe(true);
    const after = bagTotal(stock) - bagTotal(result.consumed) + bagTotal(result.produced);
    expect(after).toBeLessThanOrEqual(city.storageCap);
  });

  it("stops producing entirely once storage is already over the cap", () => {
    const result = simulateProduction({
      buildings,
      resources: { coal: 5_000, iron: 5_000 },
      city,
      stats,
      elapsedSeconds: 600,
    });
    expect(bagTotal(result.produced)).toBe(0);
    expect(result.storageFull).toBe(true);
  });

  it("settles a month offline without hanging", () => {
    // Regression guard: the smelter loop once stepped one batch at a time,
    // which turned a long absence into millions of main-thread iterations.
    const started = performance.now();
    simulateProduction({
      buildings,
      resources: { coal: 900_000, iron: 900_000 },
      city,
      stats,
      elapsedSeconds: 86_400 * 30,
    });
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("advances extractor bores downward, never upward", () => {
    const result = simulateProduction({
      buildings,
      resources: { coal: 1_000 },
      city,
      stats,
      elapsedSeconds: 3_600,
    });
    expect(result.boreDepths.e1).toBeLessThan(40);
    expect(result.boreDepths.e1).toBeGreaterThanOrEqual(1);
  });
});

describe("city constraints", () => {
  it("counts habitat crew as supply and everything else as demand", () => {
    const city = deriveCityStats([
      { kind: "habitat", level: 1 },
      { kind: "extractor", level: 1 },
    ]);
    expect(city.workersAvailable).toBe(BASE.workers + 4);
    expect(city.workersUsed).toBe(2);
  });

  it("degrades rather than breaks when power is short", () => {
    const city = deriveCityStats([
      { kind: "extractor", level: 1 },
      { kind: "extractor", level: 1 },
      { kind: "smelter", level: 1 },
    ]);
    expect(city.powerProduced).toBe(0);
    expect(city.powerEfficiency).toBeGreaterThan(0);
    expect(city.powerEfficiency).toBeLessThan(1);
  });
});

/* ==========================================================================
   Player maths
   ========================================================================== */

describe("mining", () => {
  const stats = derivePlayerStats({}, deriveCityStats([]), 1);

  it("takes longer on harder blocks", () => {
    expect(miningTimeMs(3.1, stats)).toBeGreaterThan(miningTimeMs(1, stats));
    expect(miningEnergyCost(3.1, stats)).toBeGreaterThan(miningEnergyCost(1, stats));
  });

  it("treats bedrock as unbreakable", () => {
    expect(miningTimeMs(Infinity, stats)).toBe(Infinity);
    expect(miningEnergyCost(Infinity, stats)).toBe(Infinity);
  });

  it("gets faster with mining speed but never instant", () => {
    const fast = derivePlayerStats({ miningSpeed: 900 }, deriveCityStats([]), 1);
    expect(miningTimeMs(1, fast)).toBeLessThan(miningTimeMs(1, stats));
    expect(miningTimeMs(1, fast)).toBeGreaterThanOrEqual(90);
  });
});

describe("progression", () => {
  it("needs strictly more xp for each level", () => {
    for (let level = 1; level < 40; level++) {
      expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level));
    }
  });

  it("round-trips xp to a level and back", () => {
    let total = 0;
    for (let level = 1; level < 20; level++) {
      total += xpToNext(level);
      expect(levelFromXp(total).level).toBe(level + 1);
    }
  });
});

describe("marketplace fees", () => {
  it("splits a sale without creating or destroying value", () => {
    const split = marketFeeSplit(10_000, 250, 4_000);
    expect(split.fee).toBe(250);
    expect(split.toSeller).toBe(9_750);
    expect(split.toTreasury + split.toBurn).toBe(split.fee);
  });

  it("never pays a seller more than the price", () => {
    for (const price of [1, 7, 99, 1_234, 999_999]) {
      const split = marketFeeSplit(price, 250, 4_000);
      expect(split.toSeller).toBeLessThanOrEqual(price);
      expect(split.toSeller + split.fee).toBe(price);
    }
  });
});

/* ==========================================================================
   Progression reachability

   These exist because a purely numeric balance pass will not catch a
   *deadlock*. Every early building originally cost refined ingots, which come
   only from a Smelter, which itself cost ingots — so a fresh claim could
   build nothing at all, forever, and every individual number looked fine.
   ========================================================================== */

describe("progression bootstrap", () => {
  it("never gates an early building behind refined resources", () => {
    const smelterUnlock = BUILDING_DEFS.smelter.unlockLevel;

    for (const def of BUILDING_LIST) {
      // Anything unlocking after the Smelter may reasonably want ingots.
      if (def.unlockLevel > smelterUnlock) continue;

      const cost = buildingCost(def.kind, 1);
      for (const kind of Object.keys(cost.resources) as ResourceKind[]) {
        expect(
          RESOURCE_DEFS[kind].refined,
          `${def.name} costs refined ${kind}, but a Smelter is the only source ` +
            `of refined goods and does not unlock until level ${smelterUnlock}`
        ).toBe(false);
      }
    }
  });

  it("keeps at least one level-1 building within reach of a fresh claim", () => {
    // Matches the starting kit handed out by `initPlayer`.
    const STARTING_TOKENS = 2_500;
    const AFFORDABLE_ORE = 40; // roughly a first session of hand mining

    const reachable = BUILDING_LIST.filter((def) => def.unlockLevel === 1)
      .map((def) => buildingCost(def.kind, 1))
      .filter(
        (cost) => cost.tokens <= STARTING_TOKENS && bagTotal(cost.resources) <= AFFORDABLE_ORE
      );

    expect(
      reachable.length,
      "a new player must be able to build something without passive income"
    ).toBeGreaterThan(0);
  });

  it("still requires refined goods for the late-game buildings", () => {
    // The other half of the invariant: if nothing needs ingots, the Smelter
    // has no purpose and the refining loop is decorative.
    for (const kind of ["market", "lab"] as const) {
      const cost = buildingCost(kind, 1);
      const kinds = Object.keys(cost.resources) as ResourceKind[];
      expect(kinds.some((k) => RESOURCE_DEFS[k].refined)).toBe(true);
    }
  });
});

describe("salvage", () => {
  it("pays more for rarer items at equal quality", () => {
    let previous = 0;
    for (const rarity of RARITIES) {
      const value = salvageValue({ miningSpeed: 10 }, rarity, 50);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it("pays more for a better roll of the same item", () => {
    expect(salvageValue({ miningSpeed: 10 }, "rare", 90)).toBeGreaterThan(
      salvageValue({ miningSpeed: 10 }, "rare", 10)
    );
  });
});
