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

const { db, propAccounts, propAccountRules } = await import("../src/db");
const { campaignData, rulesFromRow, stageOf, applyPreset, setBalances } = await import(
  "../src/server/campaign",
);
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
