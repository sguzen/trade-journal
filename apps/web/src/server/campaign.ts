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
  type DerivedBalances,
  FIRM_PRESETS,
  deriveBalances,
  peakFor,
  presetByKey,
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

import { dailyCumulative, equityCurve } from "@luxalgo/journal-core";

import { db, propAccountRules, propAccounts } from "@/db";
import { requireValue } from "./api";
import { nowIso } from "./ids";
import { getTimeZone } from "./settings";
import { queryTrades } from "./trades-query";
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

/**
 * What the journal says this account's balances are.
 *
 * Only closed round trips count. An open position has not moved the balance a
 * firm would act on, and its excursion is exactly what a journal of round
 * trips cannot see.
 */
export function derivedFor(account: PropAccount, row: RulesRow): DerivedBalances | null {
  if (!account.journalAccountId) return null;
  const { trades } = queryTrades({ accountIds: [account.journalAccountId] });
  const timeZone = getTimeZone();
  const dayCloseCum = dailyCumulative(trades, timeZone).map((point) => point.cumNetPnl);
  const tradeCloseCum = equityCurve(trades).map((point) => point.cumNetPnl);
  return deriveBalances(
    majorOr(row.startingBalanceMinor, account.currency),
    dayCloseCum,
    tradeCloseCum,
  );
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
  /** Where the balances came from. Typed-in figures go stale; derived ones do not. */
  balanceSource: "journal" | "manual";
  /** Closed round trips behind a derived balance. */
  tradeCount: number;
  /**
   * The peak is a lower bound, so the floor may sit lower than the firm's.
   * True only for intraday-trailing plans, whose real peak lives inside trades
   * the journal does not record.
   */
  peakIsLowerBound: boolean;
};

export function assess(account: PropAccount, row: RulesRow): CampaignAccount {
  const rules = rulesFromRow(row, account);
  const stored = snapshotFromRow(row, account);
  const derived = derivedFor(account, row);

  // A linked journal is the better record: it cannot go stale the way a typed
  // balance does. Manual figures stay in use for accounts with no journal.
  const { peak, peakIsLowerBound } = derived
    ? peakFor(derived, rules, stored.stage)
    : { peak: stored.peakBalance, peakIsLowerBound: false };
  const snapshot: AccountSnapshot = derived
    ? { ...stored, currentBalance: derived.current, peakBalance: peak }
    : stored;

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
    balanceSource: derived ? "journal" : "manual",
    tradeCount: derived?.tradeCount ?? 0,
    peakIsLowerBound,
    dayOneTarget: dayOneTarget(rules),
    evalMinDays: evalMinDays(rules),
    isFlex: isFlex(rules),
    breached,
    unrecordedBreach: breached && account.status === "active",
  };
}

export type UnconfiguredAccount = {
  accountId: string;
  firm: string;
  name: string;
  /** Whole currency; the preset's own size is ignored in favour of this. */
  accountSize: number;
};

export type CampaignData = {
  accounts: CampaignAccount[];
  /** Live accounts with no rules recorded, so the UI can offer a preset. */
  unconfigured: UnconfiguredAccount[];
  presets: { key: string; label: string; source: string; caveats: string[] }[];
};

/**
 * Every account that has rules recorded, assessed — plus the ones that do not,
 * so the screen can offer a way in rather than staying empty forever.
 */
export function campaignData(): CampaignData {
  const rows = db.select().from(propAccountRules).all();
  const configured = new Map(rows.map((r) => [r.accountId, r]));
  const all = db.select().from(propAccounts).all() as PropAccount[];

  const assessed: CampaignAccount[] = [];
  const unconfigured: UnconfiguredAccount[] = [];
  for (const account of all) {
    if (account.archived) continue;
    const row = configured.get(account.id);
    if (row) {
      assessed.push(assess(account, row));
    } else {
      unconfigured.push({
        accountId: account.id,
        firm: account.firm,
        name: account.name,
        accountSize: majorOr(account.sizeMinor, account.currency),
      });
    }
  }

  return {
    accounts: assessed,
    unconfigured,
    presets: FIRM_PRESETS.map((p) => ({
      key: p.key,
      label: `${p.rules.firmName} ${p.rules.planName}`,
      source: p.source,
      caveats: p.caveats,
    })),
  };
}

const minor = (value: number, currency: string): number =>
  Math.round(value * 10 ** currencyDigits(currency));

const minorOrNull = (value: number | null, currency: string): number | null =>
  value === null ? null : minor(value, currency);

/**
 * Copy a preset's rules onto an account.
 *
 * From here the account owns them. A later edit to the preset must never reach
 * back and rewrite the terms an account was bought under, which is why this
 * writes values rather than storing the preset key.
 *
 * The account's own size wins over the preset's: the tracker knows what was
 * actually bought, and a 25k preset applied to a 50k account should keep the
 * 50k balances.
 */
export function applyPreset(accountId: string, presetKey: string): RulesRow {
  const account = (db.select().from(propAccounts).all() as PropAccount[]).find(
    (a) => a.id === accountId,
  );
  requireValue(account, "Choose an account that exists.");
  const found = presetByKey(presetKey);
  requireValue(found, "Choose a preset that exists.");
  const preset = found as NonNullable<typeof found>;
  const chosen = account as PropAccount;

  const c = chosen.currency;
  const r = preset.rules;
  const size = chosen.sizeMinor ?? minor(r.accountSize, c);
  const now = nowIso();
  const row = {
    accountId,
    payoutProfitTargetMinor: minor(r.payoutProfitTarget, c),
    minProfitableDays: r.minProfitableDays,
    minDailyProfitMinor: minor(r.minDailyProfit, c),
    payoutSplitBps: Math.round(r.payoutSplitPct * 100),
    evalProfitTargetMinor: minor(r.evalProfitTarget, c),
    consistencyPctEval: r.consistencyPctEval,
    consistencyPctFunded: r.consistencyPctFunded,
    dailyLossLimitMinor: minorOrNull(r.dailyLossLimit, c),
    drawdownMinor: minor(r.drawdownAmount, c),
    drawdownType: r.drawdownType,
    trailStopsAtProfitMinor: minorOrNull(r.trailStopsAtProfit, c),
    fundedDrawdownMinor: minorOrNull(r.fundedDrawdownAmount, c),
    fundedDrawdownType: r.fundedDrawdownType,
    payoutCapMinor: minor(r.payoutCap, c),
    payoutBufferMinor: minor(r.payoutBuffer, c),
    payoutDailyCapMinor: minor(r.payoutDailyCap, c),
    payoutMinMinor: minor(r.payoutMin, c),
    maxPayouts: r.maxPayouts,
    // Balances start at the account's size; the trader corrects them as the
    // account trades. Guessing a peak would invent a floor.
    startingBalanceMinor: size,
    currentBalanceMinor: size,
    peakBalanceMinor: size,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(propAccountRules)
    .values(row)
    .onConflictDoUpdate({
      target: propAccountRules.accountId,
      // createdAt is deliberately absent: re-applying a preset replaces the
      // terms, it does not make the record new.
      set: { ...row, createdAt: undefined, updatedAt: now },
    })
    .run();
  return row as RulesRow;
}

/** Correct the balances the floor is computed from. */
export function setBalances(
  accountId: string,
  balances: { current?: number; peak?: number; starting?: number },
): RulesRow {
  const existing = rulesFor(accountId);
  requireValue(existing, "Record this account's rules before setting its balances.");
  const account = (db.select().from(propAccounts).all() as PropAccount[]).find(
    (a) => a.id === accountId,
  );
  requireValue(account, "Choose an account that exists.");
  const c = (account as PropAccount).currency;
  const row = existing as RulesRow;

  const next = {
    startingBalanceMinor:
      balances.starting === undefined ? row.startingBalanceMinor : minor(balances.starting, c),
    currentBalanceMinor:
      balances.current === undefined ? row.currentBalanceMinor : minor(balances.current, c),
    peakBalanceMinor: balances.peak === undefined ? row.peakBalanceMinor : minor(balances.peak, c),
    updatedAt: nowIso(),
  };
  // The peak cannot be below the balance it is supposed to be the peak of;
  // allowing it would put the trailing floor above the account's own high.
  next.peakBalanceMinor = Math.max(next.peakBalanceMinor, next.currentBalanceMinor);

  db.update(propAccountRules).set(next).where(eq(propAccountRules.accountId, accountId)).run();
  return { ...row, ...next };
}

export function rulesFor(accountId: string): RulesRow | null {
  return (
    db.select().from(propAccountRules).where(eq(propAccountRules.accountId, accountId)).get() ??
    null
  );
}
