/**
 * The presets carry primary-source work that is expensive to redo, so what is
 * pinned here is their shape and the handful of values that are easy to
 * "tidy" into something wrong later.
 */

import { describe, expect, it } from "vitest";

import { FIRM_PRESETS, dayOneTarget, drawdownFloor, presetByKey } from "../src";

describe("the preset catalogue", () => {
  it("has unique keys", () => {
    const keys = FIRM_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("says where every plan's terms came from", () => {
    for (const p of FIRM_PRESETS) {
      expect(p.source, p.key).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(p.rules.firmName, p.key).toBeTruthy();
      expect(p.rules.accountSize, p.key).toBeGreaterThan(0);
    }
  });

  it("looks a plan up by key", () => {
    expect(presetByKey("fundednext-flex-50k")?.rules.payoutSplitPct).toBe(95);
    expect(presetByKey("nope")).toBeUndefined();
  });
});

describe("the values that are easy to get wrong", () => {
  it("locks Topstep at the starting balance, not at start + 100", () => {
    // The XFA max loss limit re-pins to the starting balance after every
    // payout. Normalising this to 100 like the others would misprice the floor.
    const topstep = presetByKey("topstep-50k-combine")!;
    expect(topstep.rules.trailStopsAtProfit).toBe(0);
    expect(
      drawdownFloor(
        {
          startingBalance: 50_000,
          currentBalance: 51_000,
          peakBalance: 55_000,
          stage: "funded",
          isTerminal: false,
        },
        topstep.rules,
      ),
    ).toBe(50_000);
  });

  it("locks every other trailing plan at start + 100", () => {
    for (const p of FIRM_PRESETS) {
      if (p.key === "topstep-50k-combine") continue;
      expect(p.rules.trailStopsAtProfit, p.key).toBe(100);
    }
  });

  it("keeps the nominal targets of net-positive cycles", () => {
    // Tradeify and Topstep gate on winning days, not on a profit figure; the
    // $1 target is deliberate and must not be rounded to zero.
    expect(presetByKey("tradeify-select-25k")!.rules.payoutProfitTarget).toBe(1);
    expect(dayOneTarget(presetByKey("tradeify-select-25k")!.rules)).toBe(0);
  });

  it("carries the day-one number each plan actually implies", () => {
    // FundedNext Flex: 2,100 − 4 × 200 = 1,300 on day one.
    expect(dayOneTarget(presetByKey("fundednext-flex-50k")!.rules)).toBe(1_300);
    // FFN Steady: 2,000 − 4 × 150 = 1,400.
    expect(dayOneTarget(presetByKey("ffn-steady-50k")!.rules)).toBe(1_400);
  });

  it("flags the plans whose terms were inferred rather than read", () => {
    const flagged = FIRM_PRESETS.filter((p) => p.caveats.length > 0).map((p) => p.key);
    expect(flagged).toContain("goat-flex-50k");
    expect(flagged).toContain("ffn-steady-50k");
    expect(flagged).toContain("blue-guardian-express-50k");
  });
});
