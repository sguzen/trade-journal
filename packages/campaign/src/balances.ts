/**
 * Balances derived from a journal rather than typed in.
 *
 * The floor is only as honest as the peak it trails, and what counts as the
 * peak depends on the plan:
 *
 * - An end-of-day trailing floor follows the highest DAY-CLOSE balance, which
 *   closed trades give exactly.
 * - An intraday trailing floor follows the highest equity reached *inside* a
 *   trade. A journal of closed round trips does not record that excursion, so
 *   the best it can offer is the highest balance between trades — a LOWER
 *   bound on the real peak.
 *
 * A lower-bound peak puts the floor lower than it really is, which reads as an
 * account with more room than it has. That error points the wrong way, so it
 * is reported rather than smoothed over: `peakIsLowerBound` says when the
 * number should not be trusted on its own.
 */

import { DrawdownType, type FirmRuleSet, type Stage } from "./types";
import { drawdownFor } from "./rules";

export interface DerivedBalances {
  /** Starting balance plus every closed trade. */
  current: number;
  /** Highest day-close balance. Exact for end-of-day trailing plans. */
  eodPeak: number;
  /** Highest balance between trades. A lower bound on true intraday equity. */
  tradePeak: number;
  tradeCount: number;
}

/**
 * @param startingBalance what the account began with
 * @param dayCloseCum cumulative net P&L at each day's close, in order
 * @param tradeCloseCum cumulative net P&L after each closed trade, in order
 */
export function deriveBalances(
  startingBalance: number,
  dayCloseCum: readonly number[],
  tradeCloseCum: readonly number[],
): DerivedBalances {
  const last = tradeCloseCum.length > 0 ? tradeCloseCum[tradeCloseCum.length - 1]! : 0;
  // The starting balance is itself a peak: an account that has only ever lost
  // money still trails from where it began.
  const eodPeak = Math.max(startingBalance, ...dayCloseCum.map((c) => startingBalance + c));
  const tradePeak = Math.max(startingBalance, ...tradeCloseCum.map((c) => startingBalance + c));
  return {
    current: startingBalance + last,
    eodPeak,
    tradePeak,
    tradeCount: tradeCloseCum.length,
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
    return { peak: derived.tradePeak, peakIsLowerBound: derived.tradeCount > 0 };
  }
  // Static floors ignore the peak entirely; end-of-day ones are exact.
  return { peak: derived.eodPeak, peakIsLowerBound: false };
}
