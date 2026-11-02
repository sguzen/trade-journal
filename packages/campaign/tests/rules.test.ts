/**
 * The rule math, pinned against the cases that cost real money.
 *
 * Ported from the Python desk's campaign engine. The expensive lessons are
 * here as tests rather than comments: a trailing floor that locks ABOVE the
 * starting balance, and a funded stage running harsher drawdown terms than the
 * eval that earned it.
 */

import { describe, expect, it } from "vitest";

import {
  type AccountSnapshot,
  DEFAULT_RULES,
  DrawdownType,
  type FirmRuleSet,
  dayOneTarget,
  drawdownFloor,
  evalMinDays,
  fundedDrawdown,
  isFlex,
  riskBudget,
  shouldBreach,
} from "../src";

function rules(over: Partial<FirmRuleSet> = {}): FirmRuleSet {
  return {
    ...DEFAULT_RULES,
    firmName: "Test Firm",
    planName: "50k",
    accountSize: 50_000,
    payoutProfitTarget: 2_500,
    minProfitableDays: 5,
    minDailyProfit: 150,
    ...over,
  };
}

function account(over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    startingBalance: 50_000,
    currentBalance: 50_000,
    peakBalance: 50_000,
    stage: "eval",
    isTerminal: false,
    ...over,
  };
}

describe("payout qualification", () => {
  it("day one carries whatever the later days cannot", () => {
    // 2500 target, 5 days, 150 floor → day 1 must make 2500 − 4×150 = 1900
    expect(dayOneTarget(rules())).toBe(1_900);
  });

  it("is zero when the daily floors already cover the target", () => {
    expect(dayOneTarget(rules({ payoutProfitTarget: 400, minProfitableDays: 5 }))).toBe(0);
  });

  it("asks for the whole target when a single day qualifies", () => {
    expect(dayOneTarget(rules({ minProfitableDays: 1 }))).toBe(2_500);
  });

  it("reads the minimum eval days straight off the consistency rule", () => {
    expect(evalMinDays(rules({ consistencyPctEval: 50 }))).toBe(2);
    expect(evalMinDays(rules({ consistencyPctEval: 33 }))).toBe(4); // ceil(100/33)
    expect(evalMinDays(rules({ consistencyPctEval: 20 }))).toBe(5);
  });

  it("needs only one day with no consistency rule", () => {
    expect(evalMinDays(rules({ consistencyPctEval: null }))).toBe(1);
  });
});

describe("plan shape", () => {
  it("is Flex only when neither funded guard rail exists", () => {
    expect(isFlex(rules({ dailyLossLimit: null, consistencyPctFunded: null }))).toBe(true);
    expect(isFlex(rules({ dailyLossLimit: 1_000 }))).toBe(false);
    expect(isFlex(rules({ consistencyPctFunded: 30 }))).toBe(false);
  });
});

describe("drawdown floor", () => {
  it("never moves when static", () => {
    const r = rules({ drawdownType: DrawdownType.STATIC, drawdownAmount: 2_000 });
    expect(drawdownFloor(account({ peakBalance: 56_000 }), r)).toBe(48_000);
  });

  it("follows the peak when trailing", () => {
    const r = rules({ drawdownType: DrawdownType.TRAILING_EOD, drawdownAmount: 2_000 });
    expect(drawdownFloor(account({ peakBalance: 52_300, currentBalance: 51_000 }), r)).toBe(50_300);
  });

  it("locks the floor, not the anchor — FundedNext Flex dies at start + 100", () => {
    // The lock CAPS the floor. Once the peak has dragged the floor up to the
    // lock, the floor stays at 50,100 however high the account then goes.
    const r = rules({
      drawdownType: DrawdownType.TRAILING_EOD,
      drawdownAmount: 2_000,
      trailStopsAtProfit: 100,
    });
    expect(drawdownFloor(account({ peakBalance: 52_100 }), r)).toBe(50_100);
    expect(drawdownFloor(account({ peakBalance: 60_000 }), r)).toBe(50_100);
  });

  it("leaves the floor below the lock while the peak is still low", () => {
    const r = rules({ drawdownAmount: 2_000, trailStopsAtProfit: 100 });
    // peak 51,000 → trailing floor 49,000, which is below the 50,100 cap
    expect(drawdownFloor(account({ peakBalance: 51_000 }), r)).toBe(49_000);
  });

  it("switches terms in the funded stage — the TPT trap", () => {
    // Test runs EOD trailing on 2,000; PRO switches to intraday on 1,000.
    const r = rules({
      drawdownAmount: 2_000,
      drawdownType: DrawdownType.TRAILING_EOD,
      fundedDrawdownAmount: 1_000,
      fundedDrawdownType: DrawdownType.TRAILING_INTRADAY,
    });
    expect(fundedDrawdown(r)).toEqual({
      amount: 1_000,
      type: DrawdownType.TRAILING_INTRADAY,
    });
    const peak = { peakBalance: 53_000 };
    expect(drawdownFloor(account({ ...peak, stage: "eval" }), r)).toBe(51_000);
    expect(drawdownFloor(account({ ...peak, stage: "funded" }), r)).toBe(52_000);
  });

  it("falls back to the eval terms when the funded stage does not override", () => {
    const r = rules({ drawdownAmount: 2_000, drawdownType: DrawdownType.TRAILING_EOD });
    expect(fundedDrawdown(r)).toEqual({ amount: 2_000, type: DrawdownType.TRAILING_EOD });
  });
});

describe("breach", () => {
  it("is reached when the balance touches the floor, not only below it", () => {
    const r = rules({ drawdownAmount: 2_000, drawdownType: DrawdownType.STATIC });
    expect(shouldBreach(account({ currentBalance: 48_000 }), r)).toBe(true);
    expect(shouldBreach(account({ currentBalance: 48_000.01 }), r)).toBe(false);
  });

  it("kills an account sitting ABOVE its starting balance when the floor is locked", () => {
    // The lesson in one assertion: +50 of profit is a dead account on a plan
    // whose floor has locked at start + 100.
    const r = rules({ drawdownAmount: 2_000, trailStopsAtProfit: 100 });
    const a = account({ peakBalance: 55_000, currentBalance: 50_050 });
    expect(drawdownFloor(a, r)).toBe(50_100);
    expect(shouldBreach(a, r)).toBe(true);
  });

  it("leaves a terminal account alone", () => {
    const r = rules({ drawdownAmount: 2_000, drawdownType: DrawdownType.STATIC });
    expect(shouldBreach(account({ currentBalance: 1_000, isTerminal: true }), r)).toBe(false);
  });
});

describe("risk budget", () => {
  it("is the distance from the floor", () => {
    const r = rules({ drawdownAmount: 2_000, drawdownType: DrawdownType.STATIC });
    expect(riskBudget(account({ currentBalance: 50_400 }), r)).toBe(2_400);
  });

  it("never goes negative on a breached account", () => {
    const r = rules({ drawdownAmount: 2_000, drawdownType: DrawdownType.STATIC });
    expect(riskBudget(account({ currentBalance: 47_000 }), r)).toBe(0);
  });
});
