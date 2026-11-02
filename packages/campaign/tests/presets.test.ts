/**
 * The presets carry primary-source work that is expensive to redo, so what is
 * pinned here is their shape and the handful of values that are easy to
 * "tidy" into something wrong later.
 */

import { describe, expect, it } from "vitest";

import {
  DrawdownType,
  FIRM_PRESETS,
  dayOneTarget,
  drawdownFloor,
  fundedDrawdown,
  presetByKey,
} from "../src";

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

describe("Take Profit Trader PRO — the stage switch", () => {
  const tpt = () => presetByKey("tpt-pro-50k")!;

  it("changes drawdown TYPE between the Test and PRO, not the amount", () => {
    const r = tpt().rules;
    expect(r.drawdownAmount).toBe(2_000);
    expect(r.drawdownType).toBe(DrawdownType.TRAILING_EOD);
    expect(fundedDrawdown(r)).toEqual({
      amount: 2_000,
      type: DrawdownType.TRAILING_INTRADAY,
    });
  });

  it("is the reason a funded account must not be scored on the eval's terms", () => {
    // Same account, same peak. Only the stage differs — and with an intraday
    // trail the floor follows equity the day close never showed.
    const r = tpt().rules;
    const at = (stage: "eval" | "funded", peakBalance: number) =>
      drawdownFloor(
        { startingBalance: 50_000, currentBalance: 50_400, peakBalance, stage, isTerminal: false },
        r,
      );
    // The day closed at 50,400 but the position ran to 51,800 intraday.
    expect(at("eval", 50_400)).toBe(48_400);
    expect(at("funded", 51_800)).toBe(49_800);
  });

  it("gates on the buffer rather than on qualifying days", () => {
    const r = tpt().rules;
    expect(r.minProfitableDays).toBe(0);
    expect(r.payoutBuffer).toBe(2_000);
    // With no qualifying days, day one carries the whole buffer gate.
    expect(dayOneTarget(r)).toBe(2_000);
  });

  it("says plainly that the $10,000 conclusion is not modelled", () => {
    // The rules count payouts, not their sum, so the cap that actually ends
    // this account cannot be expressed. Silence there would be a trap.
    expect(tpt().rules.maxPayouts).toBe(0);
    expect(tpt().caveats.join(" ")).toContain("$10,000");
  });
});
