/**
 * Firm plan presets, read from each firm's own documentation.
 *
 * A preset is a starting point, not a source of truth. Applying one copies its
 * rules onto an account, and from that moment the account owns them: firms
 * change terms, and editing a preset must never rewrite what an existing
 * account was bought under.
 *
 * `source` records where the terms were read and when. `caveats` carries the
 * fields that were inferred rather than confirmed — they are shown next to the
 * preset so an unverified number cannot quietly become a trusted one.
 *
 * Every amount is whole currency, matching the rule engine. Trailing floors
 * lock at start + $100 across these firms unless noted; Topstep is the
 * exception and locks at 0 because its XFA pins to the starting balance after
 * every payout.
 */

import { DEFAULT_RULES, DrawdownType, type FirmRuleSet } from "./types";

export interface FirmPreset {
  /** Stable key; the UI shows `rules.firmName` + `rules.planName`. */
  key: string;
  rules: FirmRuleSet;
  /** Where these terms were read, and when. */
  source: string;
  /** Terms inferred rather than confirmed. Empty means every field was sourced. */
  caveats: string[];
}

const preset = (
  key: string,
  source: string,
  rules: Omit<FirmRuleSet, keyof typeof DEFAULT_RULES> & Partial<FirmRuleSet>,
  caveats: string[] = [],
): FirmPreset => ({ key, source, caveats, rules: { ...DEFAULT_RULES, ...rules } });

export const FIRM_PRESETS: FirmPreset[] = [
  preset("fundednext-flex-50k", "helpfutures.fundednext.com, read 2026-08-24", {
    firmName: "FundedNext",
    planName: "Flex 50k",
    accountSize: 50_000,
    payoutProfitTarget: 2_100,
    minProfitableDays: 5,
    minDailyProfit: 200,
    // $1,500 per cycle at a 95% split nets $1,425.
    payoutSplitPct: 95,
    payoutCap: 1_500,
    evalProfitTarget: 2_500,
    consistencyPctEval: 40,
    drawdownAmount: 1_500,
    drawdownType: DrawdownType.TRAILING_EOD,
    trailStopsAtProfit: 100,
  }),
  preset("lucid-flex-25k", "support.lucidtrading.com, read 2026-08-24", {
    firmName: "Lucid Trading",
    planName: "Flex 25k",
    accountSize: 25_000,
    payoutProfitTarget: 500,
    minProfitableDays: 5,
    minDailyProfit: 100,
    payoutCap: 1_000,
    evalProfitTarget: 1_500,
    consistencyPctEval: 50,
    drawdownAmount: 1_000,
    trailStopsAtProfit: 100,
  }),
  preset("blue-guardian-reserve-50k", "blueguardian.com/futures, read 2026-08-24", {
    firmName: "Blue Guardian",
    planName: "Reserve 50k",
    accountSize: 50_000,
    payoutProfitTarget: 3_000,
    minProfitableDays: 5,
    minDailyProfit: 150,
    // 90% split confirmed against a real payout, 2026-08.
    payoutCap: 2_000,
    evalProfitTarget: 3_000,
    consistencyPctEval: null,
    drawdownAmount: 2_000,
    trailStopsAtProfit: 100,
  }),
  preset(
    "blue-guardian-reserve-25k",
    "blueguardian.com/futures, read 2026-08-24 (no-DLL risk option)",
    {
      firmName: "Blue Guardian",
      planName: "Reserve 25k",
      accountSize: 25_000,
      payoutProfitTarget: 1_500,
      minProfitableDays: 5,
      minDailyProfit: 100,
      payoutCap: 1_000,
      evalProfitTarget: 1_500,
      consistencyPctEval: 50,
      drawdownAmount: 1_000,
      trailStopsAtProfit: 100,
    },
  ),
  preset(
    "blue-guardian-express-50k",
    "blueguardian.com/futures, read 2026-08-24",
    {
      firmName: "Blue Guardian",
      planName: "Express 50k",
      accountSize: 50_000,
      // Daily payouts rather than cycles: build the buffer to $52,100 and
      // leave it in, then withdraw $500–$1,100 a day.
      payoutProfitTarget: 2_600,
      minProfitableDays: 0,
      minDailyProfit: 0,
      payoutCap: 1_100,
      evalProfitTarget: 3_000,
      consistencyPctEval: 40,
      dailyLossLimit: 1_000,
      drawdownAmount: 2_000,
      trailStopsAtProfit: 100,
      payoutBuffer: 2_100,
      payoutDailyCap: 1_100,
      payoutMin: 500,
    },
    [
      "The daily loss limit is assumed to be a soft breach (day lock). Confirm before buying.",
      "No qualifying-day gate was documented; none is modelled.",
    ],
  ),
  preset("fundednext-rapid-pro-25k", "helpfutures.fundednext.com, read 2026-08-25", {
    firmName: "FundedNext",
    planName: "Rapid Pro 25k",
    accountSize: 25_000,
    // Rewards every 3 days, $250 min / $800 max, 40% consistency per cycle.
    payoutProfitTarget: 500,
    minProfitableDays: 0,
    minDailyProfit: 0,
    payoutCap: 800,
    evalProfitTarget: 1_500,
    consistencyPctEval: null,
    consistencyPctFunded: 40,
    drawdownAmount: 1_000,
    trailStopsAtProfit: 100,
    // The account concludes after the 5th reward — roughly $3,600 net.
    maxPayouts: 5,
  }),
  preset("lucid-pro-25k", "support.lucidtrading.com, read 2026-08-25", {
    firmName: "Lucid Trading",
    planName: "Pro 25k",
    accountSize: 25_000,
    // Buffer of $1,100 stays in (MLL + 100). No payout window, no cap on
    // how many cycles the account may run.
    payoutProfitTarget: 250,
    minProfitableDays: 0,
    minDailyProfit: 0,
    payoutCap: 1_000,
    evalProfitTarget: 1_250,
    consistencyPctEval: null,
    consistencyPctFunded: 40,
    drawdownAmount: 1_000,
    trailStopsAtProfit: 100,
    payoutBuffer: 1_100,
    payoutMin: 500,
    maxPayouts: 0,
  }),
  preset(
    "tradeify-select-25k",
    "help.tradeify.co, read 2026-08-25 (models the Select FLEX funded path)",
    {
      firmName: "Tradeify",
      planName: "Select 25k",
      accountSize: 25_000,
      // Cycle needs only to be net positive, so the target is nominal; the
      // real gate is five winning days of $100 or more.
      payoutProfitTarget: 1,
      minProfitableDays: 5,
      minDailyProfit: 100,
      payoutCap: 1_250,
      evalProfitTarget: 1_500,
      consistencyPctEval: 40,
      drawdownAmount: 1_000,
      trailStopsAtProfit: 100,
    },
    [
      "Models Select FLEX. The Select Daily path differs: $1,100 buffer, $600 cycle cap, $500 daily loss limit.",
      "The payout cap is 50% of total profit up to $1,250; only the ceiling is modelled.",
    ],
  ),
  preset(
    "topstep-50k-combine",
    "topstep.com/help, read 2026-08-25 (no-activation path with the optional soft daily loss limit)",
    {
      firmName: "Topstep",
      planName: "50k Combine",
      accountSize: 50_000,
      // XFA consistency lane: 3 trading days, 40% consistency per cycle,
      // request 50% of balance capped at $6,000 with the daily loss limit on.
      payoutProfitTarget: 1,
      minProfitableDays: 3,
      minDailyProfit: 0,
      payoutCap: 6_000,
      evalProfitTarget: 3_000,
      consistencyPctEval: 50,
      consistencyPctFunded: 40,
      dailyLossLimit: 1_000,
      drawdownAmount: 2_000,
      // Not a typo and not the +100 the other firms use: the XFA max loss
      // limit pins to the STARTING balance after every payout, so the floor
      // locks at the starting balance exactly.
      trailStopsAtProfit: 0,
    },
    [
      "The optional daily loss limit is a day lock, not a violation, and doubles the payout caps. Priced in here.",
    ],
  ),
  preset(
    "goat-flex-50k",
    "goatfundedtrader.com, read 2026-08-04",
    {
      firmName: "Goat Funded",
      planName: "Flex 50k",
      accountSize: 50_000,
      payoutProfitTarget: 500,
      minProfitableDays: 5,
      minDailyProfit: 100,
      payoutCap: 0,
      evalProfitTarget: 3_000,
      consistencyPctEval: 50,
      drawdownAmount: 2_000,
      trailStopsAtProfit: 100,
    },
    ["The winning-day amount and the payout cap were inferred, not read. Confirm before buying."],
  ),
  preset(
    "ffn-steady-50k",
    "Funded Futures Network withdrawal checklist, read 2026-08-04",
    {
      firmName: "Funded Futures Network",
      planName: "Steady 50k",
      accountSize: 50_000,
      // Buffer of $2,000 is built first; then five winning days of $150 per
      // cycle, and the balance must exceed the previous post-payout level.
      payoutProfitTarget: 2_000,
      minProfitableDays: 5,
      minDailyProfit: 150,
      payoutSplitPct: 80,
      payoutCap: 1_500,
      evalProfitTarget: 3_000,
      consistencyPctEval: 52,
      drawdownAmount: 2_000,
      trailStopsAtProfit: 100,
      payoutBuffer: 2_000,
      payoutMin: 500,
    },
    [
      "Split is 80% in sim and reportedly 90% once live. The lower figure is modelled.",
      "Caps rise from $1,500 to $2,000 after the third payout; only the opening cap is modelled.",
      "A $10,000 global cap applies across accounts and is not modelled here.",
    ],
  ),
];

export const presetByKey = (key: string): FirmPreset | undefined =>
  FIRM_PRESETS.find((p) => p.key === key);
