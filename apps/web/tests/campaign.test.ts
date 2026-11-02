/**
 * The campaign layer over the tracker's prop accounts.
 *
 * Two things are worth pinning here and nowhere else: that money survives the
 * crossing from the tracker's integer minor units into the rule engine's whole
 * currency, and that the engine disagreeing with the tracker is surfaced
 * rather than smoothed over — an account the firm has already closed can still
 * read "active" in the tracker until someone updates it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-campaign-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { eq } = await import("drizzle-orm");
const { db, propAccounts, propAccountRules, accounts, trades, tradeExcursions } =
  await import("../src/db");
const { campaignData, rulesFromRow, stageOf, applyPreset, setBalances } =
  await import("../src/server/campaign");
const { rulesFor } = await import("../src/server/campaign");
const applyPresetSync = applyPreset;
const setBalancesSync = setBalances;

afterAll(() => {
  process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

const NOW = "2026-11-02T00:00:00.000Z";

/** The assessed account, insisting there is exactly one — a silent empty list
 * would make every assertion below vacuous. */
function only<T>(rows: T[]): T {
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

function addAccount(over: Record<string, unknown> = {}) {
  const row = {
    id: "acc-1",
    firm: "FundedNext",
    name: "Flex 50k",
    program: "funded",
    status: "active",
    currency: "USD",
    sizeMinor: 5_000_000, // $50,000
    parentId: null,
    journalAccountId: null,
    openedOn: "2026-10-01",
    closedOn: null,
    renewalOn: null,
    renewalMinor: null,
    notes: "",
    archived: false,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
  db.insert(propAccounts).values(row).run();
  return row;
}

function addRules(accountId: string, over: Record<string, unknown> = {}) {
  const row = {
    accountId,
    payoutProfitTargetMinor: 250_000, // $2,500
    minProfitableDays: 5,
    minDailyProfitMinor: 15_000, // $150
    payoutSplitBps: 9_000,
    evalProfitTargetMinor: 0,
    consistencyPctEval: 50,
    consistencyPctFunded: null,
    dailyLossLimitMinor: null,
    drawdownMinor: 200_000, // $2,000
    drawdownType: "trailing_eod",
    trailStopsAtProfitMinor: null,
    fundedDrawdownMinor: null,
    fundedDrawdownType: null,
    payoutCapMinor: 0,
    payoutBufferMinor: 0,
    payoutDailyCapMinor: 0,
    payoutMinMinor: 0,
    maxPayouts: 5,
    startingBalanceMinor: 5_000_000,
    currentBalanceMinor: 5_000_000,
    peakBalanceMinor: 5_000_000,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
  db.insert(propAccountRules).values(row).run();
  return row;
}

beforeEach(() => {
  db.delete(propAccountRules).run();
  db.delete(propAccounts).run();
  db.delete(tradeExcursions).run();
  db.delete(trades).run();
  db.delete(accounts).run();
});

describe("stage", () => {
  it("reads the stage off the program, not the status", () => {
    expect(stageOf({ program: "evaluation" })).toBe("eval");
    expect(stageOf({ program: "verification" })).toBe("eval");
    expect(stageOf({ program: "funded" })).toBe("funded");
    expect(stageOf({ program: "instant_funded" })).toBe("funded");
  });
});

describe("money crosses the boundary once", () => {
  it("turns minor units into the whole currency the rules speak", () => {
    const account = addAccount();
    const row = addRules(account.id);
    const rules = rulesFromRow(row as never, account as never);
    expect(rules.accountSize).toBe(50_000);
    expect(rules.payoutProfitTarget).toBe(2_500);
    expect(rules.minDailyProfit).toBe(150);
    expect(rules.drawdownAmount).toBe(2_000);
    expect(rules.payoutSplitPct).toBe(90);
  });

  it("keeps absent distinct from zero", () => {
    // A plan with no daily loss limit is not a plan with a $0 one.
    const account = addAccount();
    const row = addRules(account.id, { dailyLossLimitMinor: null, trailStopsAtProfitMinor: 0 });
    const rules = rulesFromRow(row as never, account as never);
    expect(rules.dailyLossLimit).toBeNull();
    expect(rules.trailStopsAtProfit).toBe(0);
  });
});

describe("assessment", () => {
  it("says nothing about accounts with no rules recorded", () => {
    addAccount();
    expect(campaignData().accounts).toEqual([]);
  });

  it("reports the floor and what is left to lose", () => {
    const account = addAccount();
    addRules(account.id, { peakBalanceMinor: 5_230_000, currentBalanceMinor: 5_100_000 });
    const assessed = only(campaignData().accounts);
    expect(assessed.floor).toBe(50_300); // peak 52,300 − 2,000
    expect(assessed.riskBudget).toBe(700); // 51,000 − 50,300
    expect(assessed.breached).toBe(false);
  });

  it("flags an account the tracker still calls active but the rules have killed", () => {
    // FundedNext Flex: the floor locks at start + $100, so +$50 is dead.
    const account = addAccount({ status: "active" });
    addRules(account.id, {
      trailStopsAtProfitMinor: 10_000, // $100
      peakBalanceMinor: 5_500_000,
      currentBalanceMinor: 5_005_000, // $50,050
    });
    const assessed = only(campaignData().accounts);
    expect(assessed.floor).toBe(50_100);
    expect(assessed.breached).toBe(true);
    expect(assessed.unrecordedBreach).toBe(true);
  });

  it("does not call an already-breached account an unrecorded breach", () => {
    const account = addAccount({ status: "breached" });
    addRules(account.id, { currentBalanceMinor: 4_000_000 });
    const assessed = only(campaignData().accounts);
    expect(assessed.breached).toBe(false); // terminal accounts cannot breach again
    expect(assessed.unrecordedBreach).toBe(false);
  });

  it("judges a funded account on the funded terms", () => {
    const account = addAccount({ program: "funded" });
    addRules(account.id, {
      drawdownMinor: 200_000,
      fundedDrawdownMinor: 100_000,
      fundedDrawdownType: "trailing",
      peakBalanceMinor: 5_300_000,
      currentBalanceMinor: 5_250_000,
    });
    const assessed = only(campaignData().accounts);
    expect(assessed.floor).toBe(52_000); // 53,000 − 1,000, not − 2,000
  });

  it("carries the plan's demands alongside its floor", () => {
    const account = addAccount();
    addRules(account.id);
    const assessed = only(campaignData().accounts);
    expect(assessed.dayOneTarget).toBe(1_900); // 2,500 − 4 × 150
    expect(assessed.evalMinDays).toBe(2); // a 50% consistency rule needs two days
    expect(assessed.isFlex).toBe(true);
  });
});

describe("applying a preset", () => {
  it("copies the plan's terms onto the account", () => {
    const account = addAccount({ program: "funded", sizeMinor: 5_000_000 });
    applyPresetSync(account.id, "fundednext-flex-50k");

    const assessed = only(campaignData().accounts);
    // Flex 50k: 2,100 target over 5 days at 200 → 1,300 on day one.
    expect(assessed.dayOneTarget).toBe(1_300);
    // Balances start at the account's size, so the peak has not yet dragged
    // the floor up to the +100 lock: it is still peak − 1,500.
    expect(assessed.floor).toBe(48_500);
    expect(assessed.currentBalance).toBe(50_000);
  });

  it("keeps the account's own size over the preset's", () => {
    // A 25k plan applied to an account the tracker says is 50k keeps 50k:
    // the tracker knows what was actually bought.
    const account = addAccount({ sizeMinor: 5_000_000 });
    applyPresetSync(account.id, "lucid-flex-25k");
    const assessed = only(campaignData().accounts);
    expect(assessed.currentBalance).toBe(50_000);
  });

  it("replaces the terms when a different preset is applied", () => {
    const account = addAccount();
    applyPresetSync(account.id, "lucid-flex-25k");
    applyPresetSync(account.id, "topstep-50k-combine");
    const assessed = only(campaignData().accounts);
    // Topstep's drawdown is 2,000 against Lucid's 1,000, so the floor moved.
    expect(assessed.floor).toBe(48_000);
  });

  it("refuses an unknown preset or account", () => {
    const account = addAccount();
    expect(() => applyPresetSync(account.id, "nope")).toThrow();
    expect(() => applyPresetSync("ghost", "lucid-flex-25k")).toThrow();
  });

  it("lists accounts with no rules so the screen can offer one", () => {
    addAccount({ id: "bare", firm: "Topstep", name: "50k" });
    const data = campaignData();
    expect(data.accounts).toEqual([]);
    expect(data.unconfigured.map((a) => a.accountId)).toEqual(["bare"]);
    expect(data.presets.length).toBeGreaterThan(5);
  });
});

describe("balances", () => {
  it("never lets the peak fall below the current balance", () => {
    // A trailing floor derived from a peak below the balance would sit above
    // the account's own high.
    const account = addAccount();
    applyPresetSync(account.id, "blue-guardian-reserve-50k");
    setBalancesSync(account.id, { current: 53_000, peak: 51_000 });
    const stored = rulesFor(account.id)!;
    expect(stored.peakBalanceMinor).toBe(stored.currentBalanceMinor);
  });

  it("refuses balances for an account with no rules", () => {
    const account = addAccount();
    expect(() => setBalancesSync(account.id, { current: 1 })).toThrow();
  });
});

const addJournalAccount = (id = "j1") => {
  db.insert(accounts)
    .values({ id, name: "NQ", broker: "manual", kind: "manual", currency: "USD", createdAt: NOW })
    .run();
  return id;
};

const addTrade = (accountId: string, key: string, closedAt: string, netPnl: number) => {
  db.insert(trades)
    .values({
      key,
      accountId,
      symbol: "NQ",
      direction: "long",
      status: netPnl >= 0 ? "win" : "loss",
      openedAt: closedAt,
      closedAt,
      quantity: 1,
      openQuantity: 0,
      avgEntry: 100,
      avgExit: 100 + netPnl,
      grossPnl: netPnl,
      fees: 0,
      netPnl,
      executionCount: 2,
      executionIdsJson: "[]",
      exitsJson: "[]",
    })
    .run();
};

describe("balances derived from the journal", () => {
  it("uses the journal over a stale typed-in balance", () => {
    // The whole reason for deriving: a number typed in a week ago is wrong the
    // moment the next trade closes.
    const journalId = addJournalAccount();
    const account = addAccount({ journalAccountId: journalId });
    applyPresetSync(account.id, "blue-guardian-reserve-50k");
    setBalancesSync(account.id, { current: 50_000, peak: 50_000 });

    addTrade(journalId, "t1", "2026-10-20T15:00:00.000Z", 900);
    addTrade(journalId, "t2", "2026-10-21T15:00:00.000Z", -400);

    const assessed = only(campaignData().accounts);
    expect(assessed.balanceSource).toBe("journal");
    expect(assessed.tradeCount).toBe(2);
    expect(assessed.currentBalance).toBe(50_500);
    // EOD peak is day one's close at 50,900, so the floor trails from there:
    // 50,900 − 2,000 = 48,900, still below the +100 lock, which only caps.
    expect(assessed.floor).toBe(48_900);
  });

  it("keeps the manual balances when no journal is linked", () => {
    const account = addAccount({ journalAccountId: null });
    applyPresetSync(account.id, "blue-guardian-reserve-50k");
    setBalancesSync(account.id, { current: 51_000, peak: 51_000 });
    const assessed = only(campaignData().accounts);
    expect(assessed.balanceSource).toBe("manual");
    expect(assessed.currentBalance).toBe(51_000);
  });

  it("trails the day close, not the high-water mark inside the day", () => {
    // Two trades on the SAME day: +900 then −400. An end-of-day trailing floor
    // trails the 50,500 close, not the 50,900 the account touched between them.
    const journalId = addJournalAccount("j2");
    const account = addAccount({ journalAccountId: journalId });
    applyPresetSync(account.id, "blue-guardian-reserve-50k");
    addTrade(journalId, "t1", "2026-10-20T14:00:00.000Z", 900);
    addTrade(journalId, "t2", "2026-10-20T16:00:00.000Z", -400);

    const assessed = only(campaignData().accounts);
    expect(assessed.currentBalance).toBe(50_500);
    // Day close 50,500 − 2,000 = 48,500, below the +100 lock, so 48,500 stands.
    expect(assessed.floor).toBe(48_500);
    expect(assessed.peakIsLowerBound).toBe(false);
  });

  it("admits uncertainty on an intraday-trailing plan", () => {
    const journalId = addJournalAccount("j3");
    const account = addAccount({ journalAccountId: journalId });
    applyPresetSync(account.id, "blue-guardian-reserve-50k");
    // Switch the funded stage to intraday trailing, as TPT PRO does.
    db.update(propAccountRules)
      .set({ fundedDrawdownMinor: 100_000, fundedDrawdownType: "trailing" })
      .where(eq(propAccountRules.accountId, account.id))
      .run();
    addTrade(journalId, "t1", "2026-10-20T14:00:00.000Z", 900);
    addTrade(journalId, "t2", "2026-10-20T16:00:00.000Z", -400);

    const assessed = only(campaignData().accounts);
    expect(assessed.peakIsLowerBound).toBe(true);
    // Trade peak 50,900 − 1,000 = 49,900. The intraday peak is 400 higher
    // than the day close, so this floor sits above the EOD one (48,900).
    expect(assessed.floor).toBe(49_900);
  });

  it("reads an untraded linked account as flat, not as missing", () => {
    const journalId = addJournalAccount("j4");
    const account = addAccount({ journalAccountId: journalId });
    applyPresetSync(account.id, "blue-guardian-reserve-50k");
    const assessed = only(campaignData().accounts);
    expect(assessed.balanceSource).toBe("journal");
    expect(assessed.tradeCount).toBe(0);
    expect(assessed.currentBalance).toBe(50_000);
  });
});

describe("MFE sharpens an intraday floor", () => {
  const intraday = (accountId: string) =>
    db
      .update(propAccountRules)
      .set({ fundedDrawdownMinor: 100_000, fundedDrawdownType: "trailing" })
      .where(eq(propAccountRules.accountId, accountId))
      .run();

  it("lifts the peak to what the trade actually reached", async () => {
    const { estimateFingerprint } = await import("../src/server/market-data/estimates");
    const { queryTrades } = await import("../src/server/trades-query");

    const journalId = addJournalAccount("jm1");
    const account = addAccount({ journalAccountId: journalId });
    applyPresetSync(account.id, "blue-guardian-reserve-50k");
    intraday(account.id);
    // One trade that ran +900 in the money and closed at +100.
    addTrade(journalId, "m1", "2026-10-20T15:00:00.000Z", 100);

    const withoutMfe = only(campaignData().accounts);
    // No excursion yet: the peak can only be the 50,100 close.
    expect(withoutMfe.floor).toBe(49_100);
    expect(withoutMfe.peakIsLowerBound).toBe(true);
    expect(withoutMfe.mfeCovered).toBe(0);

    const [trade] = queryTrades({ accountIds: [journalId] }).trades;
    db.insert(tradeExcursions)
      .values({
        tradeKey: "m1",
        fingerprint: estimateFingerprint(trade!),
        provider: "csv",
        symbol: "NQ",
        resolution: "1m",
        fetchedAt: NOW,
        estimateJson: JSON.stringify({
          mae: -200,
          mfe: 900,
          sampledBars: 60,
          excludedBars: 0,
          warnings: [],
        }),
      })
      .run();

    const withMfe = only(campaignData().accounts);
    // Peak 50,900 − 1,000 = 49,900: 800 higher than the close-only floor, and
    // now exact rather than a bound.
    expect(withMfe.floor).toBe(49_900);
    expect(withMfe.peakIsLowerBound).toBe(false);
    expect(withMfe.mfeCovered).toBe(1);
  });

  it("ignores an excursion whose trade has since changed", async () => {
    // A stale estimate is worse than none: it would claim exactness about a
    // trade it no longer describes.
    const journalId = addJournalAccount("jm2");
    const account = addAccount({ journalAccountId: journalId });
    applyPresetSync(account.id, "blue-guardian-reserve-50k");
    intraday(account.id);
    addTrade(journalId, "m2", "2026-10-20T15:00:00.000Z", 100);

    db.insert(tradeExcursions)
      .values({
        tradeKey: "m2",
        fingerprint: "a fingerprint from a different version of this trade",
        provider: "csv",
        symbol: "NQ",
        resolution: "1m",
        fetchedAt: NOW,
        estimateJson: JSON.stringify({
          mae: -200,
          mfe: 900,
          sampledBars: 60,
          excludedBars: 0,
          warnings: [],
        }),
      })
      .run();

    const assessed = only(campaignData().accounts);
    expect(assessed.mfeCovered).toBe(0);
    expect(assessed.peakIsLowerBound).toBe(true);
    expect(assessed.floor).toBe(49_100);
  });

  it("leaves an end-of-day floor untouched however large the MFE", async () => {
    const { estimateFingerprint } = await import("../src/server/market-data/estimates");
    const { queryTrades } = await import("../src/server/trades-query");

    const journalId = addJournalAccount("jm3");
    const account = addAccount({ journalAccountId: journalId });
    applyPresetSync(account.id, "blue-guardian-reserve-50k"); // end-of-day trailing
    addTrade(journalId, "m3", "2026-10-20T15:00:00.000Z", 100);

    const [trade] = queryTrades({ accountIds: [journalId] }).trades;
    db.insert(tradeExcursions)
      .values({
        tradeKey: "m3",
        fingerprint: estimateFingerprint(trade!),
        provider: "csv",
        symbol: "NQ",
        resolution: "1m",
        fetchedAt: NOW,
        estimateJson: JSON.stringify({
          mae: -200,
          mfe: 5_000,
          sampledBars: 60,
          excludedBars: 0,
          warnings: [],
        }),
      })
      .run();

    const assessed = only(campaignData().accounts);
    // The firm trails the day close. What the trade touched is irrelevant.
    expect(assessed.floor).toBe(48_100);
    expect(assessed.peakIsLowerBound).toBe(false);
  });
});
