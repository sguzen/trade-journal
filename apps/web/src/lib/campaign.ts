/**
 * Types and formatting for the Campaign section.
 *
 * Every shape here mirrors what Trading Manager Pro returns through
 * /api/tmp/*. Nothing in this file computes a campaign number — TMP owns
 * accounts, firm rules and payouts, and the journal only renders them.
 */

export interface RuleSet {
  firm_name: string;
  plan_name: string;
  account_size: number;
  payout_profit_target: number;
  min_profitable_days: number;
  min_daily_profit: number;
  payout_split_pct: number;
  payout_cap: number;
  max_payouts: number;
  eval_profit_target: number;
  consistency_pct_eval: number | null;
  drawdown_amount: number;
  drawdown_type: string;
  trail_stops_at_profit: number | null;
  daily_loss_limit: number | null;
  consistency_pct_funded: number | null;
  funded_drawdown_amount: number | null;
  funded_drawdown_type: string | null;
  payout_buffer: number;
  payout_daily_cap: number;
  payout_min: number;
}

export interface DayRow {
  account_id: string;
  day: string;
  pnl: number;
  note: string;
  stage: string;
  cycle: number;
}

export interface PayoutRow {
  day: string;
  cycle: number;
  gross: number;
  net: number;
}

export interface FeeRow {
  day: string;
  kind: string;
  amount: number;
  note?: string;
}

export interface EvalProgress {
  profit: number;
  target: number;
  effective_target: number;
  target_raised: boolean;
  remaining: number;
  days: number;
  min_days: number;
  best_day: number;
  consistency_pct: number | null;
  consistency_ok: boolean;
  passable: boolean;
}

export interface PayoutProgress {
  profit: number;
  cycle_profit: number;
  profit_target: number;
  effective_target: number;
  target_raised: boolean;
  qualifying_days: number;
  days_required: number;
  next_day_target: number;
  eligible: boolean;
  suggested_request: number;
  suggested_net: number;
  /** Buffer-style firms only; 0 means classic payout cycles. */
  buffer?: number;
  buffer_remaining?: number;
  available_above_buffer?: number;
  daily_cap?: number;
  payout_min?: number;
}

export interface CampaignAccount {
  account_id: string;
  alias: string;
  rules: RuleSet;
  purchase_cost: number;
  purchase_date: string;
  state: string;
  stage: string;
  current_balance: number;
  payout_received: number;
  payout_requested_amount: number;
  cycle: number;
  profit: number;
  cycle_profit: number;
  drawdown_floor: number;
  risk_budget: number;
  net_result: number;
  total_cost: number;
  is_terminal: boolean;
  one_loss_ends_it: boolean;
  denial_reason: string;
  notes: string;
  days: DayRow[];
  payouts: PayoutRow[];
  fees: FeeRow[];
  eval?: EvalProgress;
  payout?: PayoutProgress;
}

/** Shared by campaign_stats, stats_by_firm and stats_by_plan. */
export interface GroupStats {
  accounts_purchased: number;
  in_flight: number;
  total_spent: number;
  total_received: number;
  net: number;
  roi_pct: number;
  pass_rate_pct: number | null;
  /** N behind pass_rate_pct — rule 3 forbids showing the rate without it. */
  eval_attempts_resolved: number;
  pass_rate_ci: [number, number] | null;
  pass_rate_n_sufficient: boolean;
  payout_realisation_pct: number | null;
  /** Denominator behind payout_realisation_pct (paid + denied). */
  payout_attempts: number;
  payout_realisation_ci: [number, number] | null;
  ev_per_account: number;
}

export interface PlanStats extends GroupStats {
  plan_name: string;
  firm_name: string;
  geom_ceiling_pct: number | null;
  pass_vs_ceiling: number | null;
  pass_vs_ceiling_ci: [number, number] | null;
  e_cost_per_funded: number | null;
  funded_day_avg: number | null;
  funded_days: number;
}

export interface Budget {
  month: string;
  month_spend: number;
  monthly_eval_budget: number;
  over: boolean;
  warn: boolean;
}

export interface CampaignState {
  today: string;
  accounts: CampaignAccount[];
  stats: GroupStats;
  by_firm: Record<string, GroupStats>;
  by_plan: Record<string, PlanStats>;
  presets: Record<string, RuleSet>;
  budget: Budget;
}

export interface CalendarData {
  days: Record<string, DayRow[]>;
  payout_days: Record<string, { account_id: string; net: number }[]>;
  active: string[];
}

export interface AnalyticsData {
  cashflow: { date: string; cum: number }[];
  daily: { date: string; pnl: number }[];
  per_account: Record<string, { date: string; cum: number }[]>;
  active: string[];
}

/* ── formatting ──────────────────────────────────────────────────────────── */

export const tmpUrl = (path: string) => `/api/tmp/${path}`;

export const usd = (value: number | null | undefined, decimals = 0): string => {
  if (value == null) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export const signClass = (value: number | null | undefined): string =>
  value == null || value === 0
    ? "text-muted-foreground"
    : value > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

/**
 * A rate with its sample size. Hard rule 3: no bare percentages anywhere —
 * every rate carries N, and a verdict carries a confidence interval too.
 */
export const rateWithN = (pct: number | null, n: number): string =>
  pct == null ? "—" : `${pct.toFixed(0)}% (n=${n})`;

/**
 * Pass ÷ ceiling is a verdict about whether an eval proves edge, so it is
 * either shown with its interval or withheld as too thin to read.
 */
export const verdictWithCi = (
  value: number | null,
  ci: [number, number] | null,
  nSufficient: boolean,
): { text: string; muted: boolean } => {
  if (value == null) return { text: "—", muted: true };
  if (!nSufficient || !ci) return { text: "n too small", muted: true };
  return { text: `${value.toFixed(2)} (${ci[0].toFixed(2)}–${ci[1].toFixed(2)})`, muted: false };
};
