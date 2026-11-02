/**
 * Prop-firm plan rules, and the account state they are evaluated against.
 *
 * Ported from the Python desk (`campaign/prop_campaign.py`). Money is held as
 * plain numbers in account currency here, not minor units: these are rule
 * thresholds and balances the trader reads and types, and the journal's own
 * `*_minor` integer columns stay the storage concern of the layer above.
 */

/** How the breach floor moves. */
export const DrawdownType = {
  /** Fixed at starting balance − amount, forever. */
  STATIC: "static",
  /** Follows peak equity, tick by tick. */
  TRAILING_INTRADAY: "trailing",
  /** Follows the highest end-of-day balance. */
  TRAILING_EOD: "trailing_eod",
} as const;

export type DrawdownType = (typeof DrawdownType)[keyof typeof DrawdownType];

/** Which stage's terms govern. A terminal account keeps the stage it died in. */
export type Stage = "eval" | "funded";

/**
 * A firm's plan rules, captured at purchase time.
 *
 * Snapshotted rather than looked up globally on purpose: firms change terms,
 * and an account must be evaluated against the rules that applied when it was
 * bought. A global lookup would silently rewrite the history of every past
 * account the day a firm updates its plan.
 */
export interface FirmRuleSet {
  firmName: string;
  planName: string;
  accountSize: number;

  // ── payout requirements (the business terms) ──
  /** Profit needed for a full payout. */
  payoutProfitTarget: number;
  /** Qualifying days needed. */
  minProfitableDays: number;
  /** Floor for a day to count as qualifying. */
  minDailyProfit: number;
  /** The trader's share, as a percentage. */
  payoutSplitPct: number;

  // ── eval stage ──
  evalProfitTarget: number;
  /** null = no consistency rule. */
  consistencyPctEval: number | null;

  // ── funded stage (Flex plans leave both null) ──
  consistencyPctFunded: number | null;
  dailyLossLimit: number | null;

  // ── drawdown ──
  drawdownAmount: number;
  drawdownType: DrawdownType;
  /** Trailing locks once profit reaches this. null = never locks. */
  trailStopsAtProfit: number | null;

  /**
   * Funded-stage drawdown when it differs from the eval. Firms switch:
   * TPT Test EOD → PRO intraday is the canonical trap. null = same as eval.
   */
  fundedDrawdownAmount: number | null;
  fundedDrawdownType: DrawdownType | null;

  /** Max per payout request. 0 = uncapped. */
  payoutCap: number;

  // ── Express-style payout mechanics (all 0 = classic cycle payouts) ──
  /** Cushion built once and LEFT IN the account; only profit above it is withdrawable. */
  payoutBuffer: number;
  /** Max payout per day. 0 = not a daily-payout plan. */
  payoutDailyCap: number;
  /** Smallest withdrawal the firm processes. */
  payoutMin: number;

  /** The firm closes the account after this many payouts. 0 = never. */
  maxPayouts: number;
}

/** The moving parts of a live account that the rules are applied to. */
export interface AccountSnapshot {
  startingBalance: number;
  currentBalance: number;
  /** Highest balance seen — end-of-day or intraday, per the drawdown type. */
  peakBalance: number;
  stage: Stage;
  /** A terminal account cannot breach again. */
  isTerminal: boolean;
}

/** Sensible defaults so a caller only states what the plan actually specifies. */
export const DEFAULT_RULES: Omit<
  FirmRuleSet,
  | "firmName"
  | "planName"
  | "accountSize"
  | "payoutProfitTarget"
  | "minProfitableDays"
  | "minDailyProfit"
> = {
  payoutSplitPct: 90,
  evalProfitTarget: 0,
  consistencyPctEval: 50,
  consistencyPctFunded: null,
  dailyLossLimit: null,
  drawdownAmount: 0,
  drawdownType: DrawdownType.TRAILING_EOD,
  trailStopsAtProfit: null,
  fundedDrawdownAmount: null,
  fundedDrawdownType: null,
  payoutCap: 0,
  payoutBuffer: 0,
  payoutDailyCap: 0,
  payoutMin: 0,
  // Every firm traded so far ends a funded account at the 5th payout.
  maxPayouts: 5,
};
