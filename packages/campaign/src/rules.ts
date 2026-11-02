/**
 * The rule math: what a plan demands, and when an account is dead.
 *
 * Every function here is pure. The hard cases this file exists for are the
 * ones that cost money to learn: a trailing floor that LOCKS above the
 * starting balance, and a funded stage running different drawdown terms than
 * the eval that earned it.
 */

import { type AccountSnapshot, DrawdownType, type FirmRuleSet, type Stage } from "./types";

/** A Flex-style plan: no funded daily loss limit and no funded consistency rule. */
export function isFlex(rules: FirmRuleSet): boolean {
  return rules.dailyLossLimit === null && rules.consistencyPctFunded === null;
}

/**
 * The buffer: profit that must be made on day 1 so the remaining qualifying
 * days only need to clear the daily floor.
 *
 *     day1 = X − (Y − 1) × minDaily
 *
 * This is the hardest number in the campaign and the one worth seeing before
 * the account is even traded.
 */
export function dayOneTarget(rules: FirmRuleSet): number {
  const remainingDays = Math.max(0, rules.minProfitableDays - 1);
  return Math.max(0, rules.payoutProfitTarget - remainingDays * rules.minDailyProfit);
}

/**
 * Minimum days to clear eval given the eval consistency rule.
 *
 * A 50% rule means no single day may exceed 50% of total profit, so at least
 * 2 days are required. 33% → 3 days, and so on.
 */
export function evalMinDays(rules: FirmRuleSet): number {
  if (!rules.consistencyPctEval) return 1;
  return Math.max(1, Math.ceil(100 / rules.consistencyPctEval));
}

/** The (amount, type) pair that governs the funded stage. */
export function fundedDrawdown(rules: FirmRuleSet): { amount: number; type: DrawdownType } {
  return {
    amount: rules.fundedDrawdownAmount ?? rules.drawdownAmount,
    type: rules.fundedDrawdownType ?? rules.drawdownType,
  };
}

/** The (amount, type) pair governing a given stage. */
export function drawdownFor(
  rules: FirmRuleSet,
  stage: Stage,
): { amount: number; type: DrawdownType } {
  return stage === "funded"
    ? fundedDrawdown(rules)
    : { amount: rules.drawdownAmount, type: rules.drawdownType };
}

/**
 * The balance at which this account is breached.
 *
 * Static floors never move. Trailing floors follow the peak, and lock in place
 * once profit reaches `trailStopsAtProfit` (the common Apex-style behaviour)
 * when the firm defines that threshold.
 */
export function drawdownFloor(account: AccountSnapshot, rules: FirmRuleSet): number {
  const { amount, type } = drawdownFor(rules, account.stage);

  if (type === DrawdownType.STATIC) {
    return account.startingBalance - amount;
  }

  let floor = account.peakBalance - amount;
  if (rules.trailStopsAtProfit !== null) {
    // The lock caps the FLOOR, not the trailing anchor. FundedNext Flex locks
    // at starting balance + $100 — so once the peak has been high enough to
    // drag the floor up there, the floor stays at $50,100 and the account dies
    // at a balance ABOVE where it began.
    floor = Math.min(floor, account.startingBalance + rules.trailStopsAtProfit);
  }
  return floor;
}

/**
 * How much can be lost right now before breach.
 *
 * On a Flex funded account past day 1 this is the real per-day risk capacity:
 * with no daily loss limit, the whole cushion is available to clear the daily
 * floor.
 */
export function riskBudget(account: AccountSnapshot, rules: FirmRuleSet): number {
  return Math.max(0, account.currentBalance - drawdownFloor(account, rules));
}

/**
 * Balance has touched the drawdown floor. The account is gone.
 *
 * On a locked trailing account the floor sits at the lock level — for
 * FundedNext Flex that is starting balance + $100 ($50,100 on a 50k), so an
 * account that never gets above the lock dies at a balance *above* where it
 * started. That is not a bug in the arithmetic; it is the plan.
 */
export function shouldBreach(account: AccountSnapshot, rules: FirmRuleSet): boolean {
  if (account.isTerminal) return false;
  return account.currentBalance <= drawdownFloor(account, rules);
}
