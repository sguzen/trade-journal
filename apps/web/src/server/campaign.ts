/**
 * Campaign: the rule layer over the prop accounts the tracker already keeps.
 *
 * The tracker answers "what did this account cost and pay". This answers the
 * question it cannot: *is the account still alive, and what does it still owe
 * before it pays*. Rules live in their own table keyed by account, so the
 * tracker's own records are untouched and an account with no rules recorded
 * simply has nothing to say here.
 *
 * Money crosses this boundary once. The database and the tracker speak integer
 * minor units; the rule engine speaks whole currency, because its thresholds
 * are the numbers a trader reads off a plan page. Conversion happens here and
 * nowhere else.
 */

import { eq } from "drizzle-orm";

import {
  type AccountSnapshot,
  DEFAULT_RULES,
  type DrawdownType,
  type FirmRuleSet,
  type Stage,
  dayOneTarget,
  drawdownFloor,
  evalMinDays,
  isFlex,
  riskBudget,
  shouldBreach,
} from "@desk/campaign";

import { db, propAccountRules, propAccounts } from "@/db";
import { currencyDigits, type PropAccount } from "@/lib/prop-firms";

type RulesRow = typeof propAccountRules.$inferSelect;

const DRAWDOWN_TYPES = ["static", "trailing", "trailing_eod"] as const;

/**
 * Which stage's terms govern this account right now.
 *
 * A breached or closed account keeps the stage it died in, so a failed
 * evaluation never reads as a funded account that blew up. The tracker records
 * that stage in `program`, which is why status alone is not enough.
 */
export function stageOf(account: Pick<PropAccount, "program">): Stage {
  return account.program === "evaluation" || account.program === "verification" ? "eval" : "funded";
}

const asDrawdownType = (
  value: string | null,
  fallback: DrawdownType | null,
): DrawdownType | null => {
  if (value === null) return fallback;
  return (DRAWDOWN_TYPES as readonly string[]).includes(value) ? (value as DrawdownType) : fallback;
};

/** Minor units → whole currency. `null` stays `null`: absent is not zero. */
const major = (value: number | null, currency: string): number | null =>
  value === null ? null : value / 10 ** currencyDigits(currency);

const majorOr = (value: number | null, currency: string, fallback = 0): number =>
  major(value, currency) ?? fallback;

export function rulesFromRow(row: RulesRow, account: PropAccount): FirmRuleSet {
  const c = account.currency;
  return {
    ...DEFAULT_RULES,
    firmName: account.firm,
    planName: account.name,
    accountSize: majorOr(account.sizeMinor, c),

    payoutProfitTarget: majorOr(row.payoutProfitTargetMinor, c),
    minProfitableDays: row.minProfitableDays,
    minDailyProfit: majorOr(row.minDailyProfitMinor, c),
    payoutSplitPct: row.payoutSplitBps / 100,

    evalProfitTarget: majorOr(row.evalProfitTargetMinor, c),
    consistencyPctEval: row.consistencyPctEval,
    consistencyPctFunded: row.consistencyPctFunded,
    dailyLossLimit: major(row.dailyLossLimitMinor, c),

    drawdownAmount: majorOr(row.drawdownMinor, c),
    drawdownType: asDrawdownType(row.drawdownType, DEFAULT_RULES.drawdownType)!,
    trailStopsAtProfit: major(row.trailStopsAtProfitMinor, c),
    fundedDrawdownAmount: major(row.fundedDrawdownMinor, c),
    fundedDrawdownType: asDrawdownType(row.fundedDrawdownType, null),

    payoutCap: majorOr(row.payoutCapMinor, c),
    payoutBuffer: majorOr(row.payoutBufferMinor, c),
    payoutDailyCap: majorOr(row.payoutDailyCapMinor, c),
    payoutMin: majorOr(row.payoutMinMinor, c),
    maxPayouts: row.maxPayouts,
  };
}

export function snapshotFromRow(row: RulesRow, account: PropAccount): AccountSnapshot {
  const c = account.currency;
  return {
    startingBalance: majorOr(row.startingBalanceMinor, c),
    currentBalance: majorOr(row.currentBalanceMinor, c),
    peakBalance: majorOr(row.peakBalanceMinor, c),
    stage: stageOf(account),
    isTerminal: account.status === "breached" || account.status === "closed",
  };
}

export type CampaignAccount = {
  accountId: string;
  firm: string;
  name: string;
  currency: string;
  stage: Stage;
  status: PropAccount["status"];
  /** Whole currency, so the caller formats once with the tracker's helpers. */
  floor: number;
  riskBudget: number;
  currentBalance: number;
  dayOneTarget: number;
  evalMinDays: number;
  isFlex: boolean;
  /**
   * The engine says this account is dead. When the tracker still shows it
   * active, that gap is the whole point of this screen.
   */
  breached: boolean;
  /** The account is breached but the tracker has not been told. */
  unrecordedBreach: boolean;
};

export function assess(account: PropAccount, row: RulesRow): CampaignAccount {
  const rules = rulesFromRow(row, account);
  const snapshot = snapshotFromRow(row, account);
  const breached = shouldBreach(snapshot, rules);
  return {
    accountId: account.id,
    firm: account.firm,
    name: account.name,
    currency: account.currency,
    stage: snapshot.stage,
    status: account.status,
    floor: drawdownFloor(snapshot, rules),
    riskBudget: riskBudget(snapshot, rules),
    currentBalance: snapshot.currentBalance,
    dayOneTarget: dayOneTarget(rules),
    evalMinDays: evalMinDays(rules),
    isFlex: isFlex(rules),
    breached,
    unrecordedBreach: breached && account.status === "active",
  };
}

/** Every account that has rules recorded, assessed. Accounts without rules are absent. */
export function campaignData(): { accounts: CampaignAccount[] } {
  const rows = db.select().from(propAccountRules).all();
  if (rows.length === 0) return { accounts: [] };

  const byId = new Map(
    (db.select().from(propAccounts).all() as PropAccount[]).map((a) => [a.id, a]),
  );
  const assessed: CampaignAccount[] = [];
  for (const row of rows) {
    const account = byId.get(row.accountId);
    // A rules row whose account was deleted outlives nothing useful; the
    // cascade should have taken it, so skip rather than invent an account.
    if (account) assessed.push(assess(account, row));
  }
  return { accounts: assessed };
}

export function rulesFor(accountId: string): RulesRow | null {
  return (
    db.select().from(propAccountRules).where(eq(propAccountRules.accountId, accountId)).get() ??
    null
  );
}
