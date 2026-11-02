/**
 * Derived balances, and the one place the derivation cannot be exact.
 */

import { describe, expect, it } from "vitest";

import { DrawdownType, DEFAULT_RULES, deriveBalances, peakFor, type FirmRuleSet } from "../src";

const rules = (over: Partial<FirmRuleSet> = {}): FirmRuleSet => ({
  ...DEFAULT_RULES,
  firmName: "F",
  planName: "P",
  accountSize: 50_000,
  payoutProfitTarget: 0,
  minProfitableDays: 0,
  minDailyProfit: 0,
  ...over,
});

describe("deriving balances from closed trades", () => {
  it("adds every closed trade to the starting balance", () => {
    const d = deriveBalances(50_000, [300, 100], [500, 300, 100]);
    expect(d.current).toBe(50_100);
    expect(d.tradeCount).toBe(3);
  });

  it("takes the day peak from day closes, not from inside the day", () => {
    // The day ran to +500 mid-session and closed at +300. An end-of-day
    // trailing floor trails the close, so the peak is 50,300.
    const d = deriveBalances(50_000, [300], [500, 300]);
    expect(d.eodPeak).toBe(50_300);
    expect(d.tradePeak).toBe(50_500);
  });

  it("treats the starting balance as a peak of its own", () => {
    // An account that only ever lost still trails from where it began.
    const d = deriveBalances(50_000, [-400], [-200, -400]);
    expect(d.eodPeak).toBe(50_000);
    expect(d.tradePeak).toBe(50_000);
    expect(d.current).toBe(49_600);
  });

  it("handles an account that has not traded", () => {
    const d = deriveBalances(50_000, [], []);
    expect(d).toEqual({ current: 50_000, eodPeak: 50_000, tradePeak: 50_000, tradeCount: 0 });
  });
});

describe("which peak a plan trails", () => {
  it("uses the exact day peak for end-of-day trailing", () => {
    const d = deriveBalances(50_000, [300], [500, 300]);
    const r = rules({ drawdownType: DrawdownType.TRAILING_EOD });
    expect(peakFor(d, r, "eval")).toEqual({ peak: 50_300, peakIsLowerBound: false });
  });

  it("admits the intraday peak is only a lower bound", () => {
    // Closed round trips carry no excursion, so the true intraday high is
    // unknowable from here — and guessing low overstates the room left.
    const d = deriveBalances(50_000, [300], [500, 300]);
    const r = rules({ drawdownType: DrawdownType.TRAILING_INTRADAY });
    expect(peakFor(d, r, "eval")).toEqual({ peak: 50_500, peakIsLowerBound: true });
  });

  it("claims no uncertainty when nothing has been traded", () => {
    const d = deriveBalances(50_000, [], []);
    const r = rules({ drawdownType: DrawdownType.TRAILING_INTRADAY });
    expect(peakFor(d, r, "eval").peakIsLowerBound).toBe(false);
  });

  it("follows the funded stage's drawdown type, not the eval's", () => {
    const d = deriveBalances(50_000, [300], [500, 300]);
    const r = rules({
      drawdownType: DrawdownType.TRAILING_EOD,
      fundedDrawdownType: DrawdownType.TRAILING_INTRADAY,
    });
    expect(peakFor(d, r, "eval").peakIsLowerBound).toBe(false);
    expect(peakFor(d, r, "funded").peakIsLowerBound).toBe(true);
  });

  it("ignores the peak question entirely for a static floor", () => {
    const d = deriveBalances(50_000, [300], [500, 300]);
    const r = rules({ drawdownType: DrawdownType.STATIC });
    expect(peakFor(d, r, "eval").peakIsLowerBound).toBe(false);
  });
});
