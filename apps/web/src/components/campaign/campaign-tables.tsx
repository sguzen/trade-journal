"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Badge } from "../ui/badge";
import {
  type CampaignAccount,
  type GroupStats,
  type PlanStats,
  rateWithN,
  signClass,
  usd,
  verdictWithCi,
} from "@/lib/campaign";

/**
 * By-plan economics — the granularity that decides what to buy next.
 *
 * Deviates from TMP's UI deliberately: TMP prints a bare "Pass 33%". Hard
 * rule 3 requires the N, and a CI where the number is a verdict. P÷C is the
 * verdict ("is this eval evidence of edge?"), so it shows its interval or
 * says the sample is too thin. Both come from TMP — no statistics here.
 */
export function ByPlanTable({ byPlan }: { byPlan: Record<string, PlanStats> }) {
  const rows = Object.entries(byPlan);
  if (!rows.length) return <p className="text-sm text-muted-foreground p-3">No plans yet.</p>;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Bought</TableHead>
            <TableHead className="text-right">Live</TableHead>
            <TableHead className="text-right">Spent</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead className="text-right">Pass</TableHead>
            <TableHead className="text-right" title="geometric pass ceiling: DD ÷ (DD + eval target)">
              Ceiling
            </TableHead>
            <TableHead className="text-right" title="pass ÷ ceiling with 95% Wilson interval">
              P÷C
            </TableHead>
            <TableHead className="text-right">E[cost→funded]</TableHead>
            <TableHead className="text-right">Funded $/day</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([plan, s]) => {
            const verdict = verdictWithCi(
              s.pass_vs_ceiling,
              s.pass_vs_ceiling_ci,
              s.pass_rate_n_sufficient,
            );
            return (
              <TableRow key={plan}>
                <TableCell className="font-medium">{plan}</TableCell>
                <TableCell className="text-right tabular-nums">{s.accounts_purchased}</TableCell>
                <TableCell className="text-right tabular-nums">{s.in_flight}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(s.total_spent)}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(s.total_received)}</TableCell>
                <TableCell className={`text-right tabular-nums ${signClass(s.net)}`}>
                  {usd(s.net)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {rateWithN(s.pass_rate_pct, s.eval_attempts_resolved)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.geom_ceiling_pct == null ? "—" : `${s.geom_ceiling_pct}%`}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    verdict.muted
                      ? "text-muted-foreground"
                      : s.pass_vs_ceiling != null && s.pass_vs_ceiling <= 0.65
                        ? "text-red-600 dark:text-red-400"
                        : ""
                  }`}
                >
                  {verdict.text}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.e_cost_per_funded == null ? "—" : usd(s.e_cost_per_funded)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${signClass(s.funded_day_avg)}`}>
                  {s.funded_day_avg == null ? (
                    "—"
                  ) : (
                    <>
                      {usd(s.funded_day_avg)}{" "}
                      <span className="text-muted-foreground text-xs">({s.funded_days}d)</span>
                    </>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground p-3">
        Ceiling = DD ÷ (DD + eval target): what path geometry alone allows. A pass rate in the
        ≤0.65×ceiling band is what zero edge realises — eval passes are not edge; the funded $/day
        column is. P÷C intervals are 95% Wilson; below 10 resolved attempts the ratio is withheld
        rather than shown as a number worth believing.
      </p>
    </>
  );
}

export function ByFirmTable({ byFirm }: { byFirm: Record<string, GroupStats> }) {
  const rows = Object.entries(byFirm);
  if (!rows.length) return <p className="text-sm text-muted-foreground p-3">No firms yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Firm</TableHead>
          <TableHead className="text-right">Bought</TableHead>
          <TableHead className="text-right">Live</TableHead>
          <TableHead className="text-right">Spent</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="text-right">Pass</TableHead>
          <TableHead className="text-right">Realised</TableHead>
          <TableHead className="text-right">EV / acct</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([firm, s]) => (
          <TableRow key={firm}>
            <TableCell className="font-medium">{firm}</TableCell>
            <TableCell className="text-right tabular-nums">{s.accounts_purchased}</TableCell>
            <TableCell className="text-right tabular-nums">{s.in_flight}</TableCell>
            <TableCell className="text-right tabular-nums">{usd(s.total_spent)}</TableCell>
            <TableCell className="text-right tabular-nums">{usd(s.total_received)}</TableCell>
            <TableCell className={`text-right tabular-nums ${signClass(s.net)}`}>
              {usd(s.net)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {rateWithN(s.pass_rate_pct, s.eval_attempts_resolved)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {/* Realisation is also a rate: it carries the payout attempts behind it. */}
              {rateWithN(s.payout_realisation_pct, s.payout_attempts)}
            </TableCell>
            <TableCell className={`text-right tabular-nums ${signClass(s.ev_per_account)}`}>
              {usd(s.ev_per_account)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ClosedTable({
  accounts,
  onDelete,
}: {
  accounts: CampaignAccount[];
  onDelete: (id: string) => void;
}) {
  const closed = accounts.filter((a) => a.is_terminal);
  if (!closed.length) return <p className="text-sm text-muted-foreground p-3">None yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Firm</TableHead>
          <TableHead>Bought</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Payout</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {closed.map((a) => (
          <TableRow key={a.account_id}>
            <TableCell className="font-medium">
              {a.account_id}
              {a.alias ? (
                <span className="text-muted-foreground text-xs"> → {a.alias}</span>
              ) : null}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{a.state.replace("_", " ")}</Badge>
            </TableCell>
            <TableCell>{a.rules.firm_name}</TableCell>
            <TableCell className="tabular-nums">{a.purchase_date}</TableCell>
            <TableCell
              className="text-right tabular-nums"
              title={
                a.total_cost > a.purchase_cost
                  ? `eval fee + ${usd(a.total_cost - a.purchase_cost)} side fees`
                  : "eval fee"
              }
            >
              {usd(a.total_cost)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{usd(a.payout_received)}</TableCell>
            <TableCell className={`text-right tabular-nums ${signClass(a.net_result)}`}>
              {usd(a.net_result)}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">{a.denial_reason}</TableCell>
            <TableCell>
              <button
                type="button"
                className="text-red-600 dark:text-red-400 text-xs hover:underline"
                onClick={() => onDelete(a.account_id)}
              >
                ✕
              </button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
