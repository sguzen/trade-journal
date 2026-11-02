/**
 * Derived balances, and the difference MFE makes to an intraday floor.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_RULES,
  DrawdownType,
  type FirmRuleSet,
  type TradeStep,
  deriveBalances,
  peakFor,
} from "../src";

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

const step = (netPnl: number, mfe: number | null = null): TradeStep => ({ netPnl, mfe });

describe("deriving balances from closed trades", () => {
  it("adds every closed trade to the starting balance", () => {
    const d = deriveBalances(50_000, [300, 100], [step(500), step(-200), step(-200)]);
    expect(d.current).toBe(50_100);
    expect(d.tradeCount).toBe(3);
  });

  it("takes the day peak from day closes, not from inside the day", () => {
    // The day ran to +500 and closed at +300. An end-of-day trailing floor
    // trails the close.
    const d = deriveBalances(50_000, [300], [step(500), step(-200)]);
    expect(d.eodPeak).toBe(50_300);
    expect(d.tradePeak).toBe(50_500);
  });

  it("treats the starting balance as a peak of its own", () => {
    const d = deriveBalances(50_000, [-400], [step(-200), step(-200)]);
    expect(d.eodPeak).toBe(50_000);
    expect(d.tradePeak).toBe(50_000);
    expect(d.current).toBe(49_600);
  });

  it("handles an account that has not traded", () => {
    const d = deriveBalances(50_000, [], []);
    expect(d.current).toBe(50_000);
    expect(d.intradayPeak).toBe(50_000);
    expect(d.tradeCount).toBe(0);
    expect(d.mfeCovered).toBe(0);
  });
});

describe("MFE inside a trade", () => {
  it("lifts the intraday peak above anything the closes show", () => {
    // One trade: opened, ran +800 in the money, closed at +100. Between-trade
    // balances never show the 50,800 the account actually reached.
    const d = deriveBalances(50_000, [100], [step(100, 800)]);
    expect(d.tradePeak).toBe(50_100);
    expect(d.intradayPeak).toBe(50_800);
    expect(d.mfeCovered).toBe(1);
  });

  it("measures MFE from the balance before the trade, not from the start", () => {
    // Second trade opens at 50,400 and runs 300 further in the money.
    const d = deriveBalances(50_000, [600], [step(400, 400), step(200, 300)]);
    expect(d.intradayPeak).toBe(50_700);
  });

  it("ignores a losing trade's MFE of zero", () => {
    const d = deriveBalances(50_000, [-300], [step(-300, 0)]);
    expect(d.intradayPeak).toBe(50_000);
    expect(d.mfeCovered).toBe(1);
  });

  it("never lets a negative MFE drag the peak down", () => {
    // A provider that reports MFE signed the other way must not invent a peak
    // below the balance the trade opened at.
    const d = deriveBalances(50_000, [-300], [step(-300, -500)]);
    expect(d.intradayPeak).toBe(50_000);
  });

  it("counts how many trades it could see inside", () => {
    const d = deriveBalances(50_000, [600], [step(400, 400), step(200, null)]);
    expect(d.mfeCovered).toBe(1);
    expect(d.tradeCount).toBe(2);
  });
});

describe("which peak a plan trails", () => {
  it("uses the exact day peak for end-of-day trailing", () => {
    const d = deriveBalances(50_000, [300], [step(500, 900), step(-200)]);
    const r = rules({ drawdownType: DrawdownType.TRAILING_EOD });
    // MFE is irrelevant to an end-of-day floor, however large.
    expect(peakFor(d, r, "eval")).toEqual({ peak: 50_300, peakIsLowerBound: false });
  });

  it("is exact for intraday trailing once every trade has an MFE", () => {
    const d = deriveBalances(50_000, [300], [step(500, 900), step(-200, 50)]);
    const r = rules({ drawdownType: DrawdownType.TRAILING_INTRADAY });
    expect(peakFor(d, r, "eval")).toEqual({ peak: 50_900, peakIsLowerBound: false });
  });

  it("admits a bound while any trade is missing its MFE", () => {
    const d = deriveBalances(50_000, [300], [step(500, 900), step(-200)]);
    const r = rules({ drawdownType: DrawdownType.TRAILING_INTRADAY });
    expect(peakFor(d, r, "eval")).toEqual({ peak: 50_900, peakIsLowerBound: true });
  });

  it("claims no uncertainty when nothing has been traded", () => {
    const d = deriveBalances(50_000, [], []);
    const r = rules({ drawdownType: DrawdownType.TRAILING_INTRADAY });
    expect(peakFor(d, r, "eval").peakIsLowerBound).toBe(false);
  });

  it("follows the funded stage's drawdown type, not the eval's", () => {
    const d = deriveBalances(50_000, [300], [step(500), step(-200)]);
    const r = rules({
      drawdownType: DrawdownType.TRAILING_EOD,
      fundedDrawdownType: DrawdownType.TRAILING_INTRADAY,
    });
    expect(peakFor(d, r, "eval").peakIsLowerBound).toBe(false);
    expect(peakFor(d, r, "funded").peakIsLowerBound).toBe(true);
  });

  it("ignores the peak question entirely for a static floor", () => {
    const d = deriveBalances(50_000, [300], [step(500), step(-200)]);
    const r = rules({ drawdownType: DrawdownType.STATIC });
    expect(peakFor(d, r, "eval").peakIsLowerBound).toBe(false);
  });
});
