/**
 * Balances derived from a journal rather than typed in.
 *
 * The floor is only as honest as the peak it trails, and what counts as the
 * peak depends on the plan:
 *
 * - An end-of-day trailing floor follows the highest DAY-CLOSE balance, which
 *   closed trades give exactly.
 * - An intraday trailing floor follows the highest equity reached *inside* a
 *   trade. That needs each trade's peak unrealized profit — its MFE. Where the
 *   journal has estimated one from market data the peak is exact; where it has
 *   not, the best available number is the balance between trades, which is a
 *   LOWER bound.
 *
 * A lower-bound peak puts the floor lower than it really is, which reads as an
 * account with more room than it has. That error points the wrong way, so the
 * derivation reports how many trades it could see inside rather than quietly
 * averaging the two cases together.
 */

import { DrawdownType, type FirmRuleSet, type Stage } from "./types";
import { drawdownFor } from "./rules";

export interface TradeStep {
  netPnl: number;
  /**
   * Peak unrealized profit during the trade, in account currency, or null when
   * no estimate exists. Never negative: a trade that only ever lost has an MFE
   * of zero, not of its worst point.
   */
  mfe: number | null;
}

export interface DerivedBalances {
  /** Starting balance plus every closed trade. */
  current: number;
  /** Highest day-close balance. Exact for end-of-day trailing plans. */
  eodPeak: number;
  /** Highest balance BETWEEN trades, ignoring what happened inside them. */
  tradePeak: number;
  /** Highest equity including each trade's MFE where one is known. */
  intradayPeak: number;
  tradeCount: number;
  /** Trades whose MFE was known. Below `tradeCount`, `intradayPeak` is a floor. */
  mfeCovered: number;
}

/**
 * @param startingBalance what the account began with
 * @param dayCloseCum cumulative net P&L at each day's close, in order
 * @param steps closed trades in close order, each with its MFE when known
 */
export function deriveBalances(
  startingBalance: number,
  dayCloseCum: readonly number[],
  steps: readonly TradeStep[],
): DerivedBalances {
  // The starting balance is itself a peak: an account that has only ever lost
  // money still trails from where it began.
  let balance = startingBalance;
  let tradePeak = startingBalance;
  let intradayPeak = startingBalance;
  let mfeCovered = 0;

  for (const step of steps) {
    if (step.mfe !== null) {
      mfeCovered += 1;
      // The high water mark reached while the position was open.
      intradayPeak = Math.max(intradayPeak, balance + Math.max(0, step.mfe));
    }
    balance += step.netPnl;
    tradePeak = Math.max(tradePeak, balance);
    intradayPeak = Math.max(intradayPeak, balance);
  }

  const eodPeak = Math.max(startingBalance, ...dayCloseCum.map((c) => startingBalance + c));
  return {
    current: balance,
    eodPeak,
    tradePeak,
    intradayPeak,
    tradeCount: steps.length,
    mfeCovered,
  };
}

/** Which derived peak the plan's drawdown actually trails, and how sure it is. */
export function peakFor(
  derived: DerivedBalances,
  rules: FirmRuleSet,
  stage: Stage,
): { peak: number; peakIsLowerBound: boolean } {
  const { type } = drawdownFor(rules, stage);
  if (type === DrawdownType.TRAILING_INTRADAY) {
    return {
      peak: derived.intradayPeak,
      // Exact once every trade has an MFE; a bound while any is missing.
      peakIsLowerBound: derived.mfeCovered < derived.tradeCount,
    };
  }
  // Static floors ignore the peak entirely; end-of-day ones are exact.
  return { peak: derived.eodPeak, peakIsLowerBound: false };
}
