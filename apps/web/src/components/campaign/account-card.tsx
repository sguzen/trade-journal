"use client";

import { useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { type CampaignAccount, signClass, usd } from "@/lib/campaign";

/** Progress bar matching TMP's: fills to 100% and flags when full. */
function Progress({
  label,
  value,
  target,
  right,
}: {
  label: string;
  value: number;
  target: number;
  right: string;
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{right}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Qualifying-day pips — discrete, because partial days do not count. */
function DayPips({ done, total }: { done: number; total: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Qualifying days</span>
        <span className="tabular-nums">
          {done} / {total}
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i < done ? (done >= total ? "bg-emerald-500" : "bg-primary") : "bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone: "good" | "warn"; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs ${
        tone === "good"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      }`}
    >
      {children}
    </span>
  );
}

/** All four consistency states TMP distinguishes. */
function EvalSection({ account }: { account: CampaignAccount }) {
  const e = account.eval;
  if (!e) return null;
  const consistency =
    e.consistency_pct == null ? (
      <Chip tone="good">✓ no consistency rule</Chip>
    ) : e.target_raised ? (
      <Chip tone="warn">
        ⚠ {usd(e.best_day)} day raises target to {usd(e.effective_target)} ({e.consistency_pct}%
        rule)
      </Chip>
    ) : e.consistency_ok ? (
      <Chip tone="good">✓ consistency ≤ {e.consistency_pct}%</Chip>
    ) : (
      <Chip tone="warn">
        ⚠ best day {usd(e.best_day)} over {e.consistency_pct}% — cleared by reaching{" "}
        {usd(e.effective_target)}
      </Chip>
    );
  return (
    <div className="space-y-2">
      <Progress
        label="Eval profit"
        value={e.profit}
        target={e.effective_target}
        right={`${usd(e.profit)} / ${usd(e.effective_target)}`}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          Days <b className="text-foreground">{e.days}</b> (min {e.min_days})
        </span>
        <span>
          Remaining <b className="text-foreground">{usd(e.remaining)}</b>
        </span>
      </div>
      <div>{consistency}</div>
    </div>
  );
}

/** Buffer-style and classic-cycle firms render differently. */
function FundedSection({ account }: { account: CampaignAccount }) {
  const p = account.payout;
  if (!p) return null;
  const eligible = p.eligible ? (
    <Chip tone="good">
      ✓ payout eligible — request {usd(p.suggested_request)} (nets {usd(p.suggested_net)})
    </Chip>
  ) : (
    <span className="text-xs text-muted-foreground">
      Next day target <b className="text-foreground">{usd(p.next_day_target)}</b>
    </span>
  );

  if ((p.buffer ?? 0) > 0) {
    const skim =
      (p.buffer_remaining ?? 0) <= 0 ? (
        <span className="text-xs text-muted-foreground">
          Withdrawable now{" "}
          <b className="text-foreground">
            {usd(Math.min(p.available_above_buffer ?? 0, p.daily_cap || (p.available_above_buffer ?? 0)))}
          </b>{" "}
          (min {usd(p.payout_min)}, max {usd(p.daily_cap)}/day)
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          Buffer remaining <b className="text-foreground">{usd(p.buffer_remaining)}</b>
        </span>
      );
    return (
      <div className="space-y-2">
        <Progress
          label="Buffer"
          value={p.profit}
          target={p.buffer ?? 0}
          right={`${usd(Math.min(p.profit, p.buffer ?? 0))} / ${usd(p.buffer)}`}
        />
        {skim}
        <div>{eligible}</div>
      </div>
    );
  }

  const target = p.effective_target ?? p.profit_target;
  return (
    <div className="space-y-2">
      <DayPips done={p.qualifying_days} total={p.days_required} />
      <Progress
        label="Profit to target"
        value={p.profit}
        target={target}
        right={`${usd(p.profit)} / ${usd(target)}`}
      />
      {p.target_raised ? (
        <Chip tone="warn">⚠ consistency raises target from {usd(p.profit_target)}</Chip>
      ) : null}
      <div>{eligible}</div>
    </div>
  );
}

export type ActionKind =
  | "logday"
  | "pass"
  | "request"
  | "paid"
  | "denied"
  | "fee"
  | "alias"
  | "rules"
  | "retire"
  | "breach"
  | "delete";

export function AccountCard({
  account,
  today,
  onAction,
  children,
}: {
  account: CampaignAccount;
  today: string;
  onAction: (kind: ActionKind, account: CampaignAccount) => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const doneToday = !account.is_terminal && account.days.some((d) => d.day === today);
  const delta = account.stage === "funded" ? account.cycle_profit : account.profit;

  const act = (kind: ActionKind, label: string, variant: "default" | "ghost" = "ghost") => (
    <Button
      key={kind}
      size="sm"
      variant={variant}
      className="h-7 text-xs"
      onClick={() => onAction(kind, account)}
    >
      {label}
    </Button>
  );

  const actions: React.ReactNode[] = [];
  if (!account.is_terminal) {
    actions.push(
      act("logday", doneToday ? "✓ Logged today" : "Log day", doneToday ? "ghost" : "default"),
    );
    if (account.stage === "eval")
      actions.push(act("pass", "Passed → funded", account.eval?.passable ? "default" : "ghost"));
    else if (account.state === "payout_requested") {
      actions.push(act("paid", "Mark paid", "default"));
      actions.push(act("denied", "Denied"));
    } else if (account.payout?.eligible) actions.push(act("request", "Request payout", "default"));
    actions.push(act("fee", "＄ fee"));
    actions.push(act("alias", "✎ alias"));
    actions.push(act("rules", "⚙ rules"));
    if (account.stage !== "eval") actions.push(act("retire", "⏏ retire"));
    actions.push(act("breach", "✕ breached"));
    actions.push(act("delete", "🗑 delete"));
  }

  const dayRows = [
    ...account.payouts.map((p) => ({
      key: `payout-${p.day}-${p.cycle}`,
      left: p.day,
      tag: `payout c${p.cycle}`,
      value: `💰 ${usd(p.net)}`,
      cls: "text-emerald-600 dark:text-emerald-400",
    })),
    ...account.fees.map((f, i) => ({
      key: `fee-${f.day}-${i}`,
      left: f.day,
      tag: `${f.kind} fee${f.note ? ` · ${f.note}` : ""}`,
      value: `💸 −${usd(f.amount)}`,
      cls: "text-red-600 dark:text-red-400",
    })),
    ...account.days.slice(0, 8).map((d) => ({
      key: `day-${d.day}-${d.account_id}`,
      left: d.day,
      tag: d.stage === "eval" ? "eval" : d.cycle > 1 ? `c${d.cycle}` : "",
      value: usd(d.pnl),
      cls: signClass(d.pnl),
    })),
  ];

  return (
    <Card className={doneToday ? "border-emerald-500/40" : undefined}>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{account.account_id}</span>
          {account.alias ? (
            <span className="text-xs text-muted-foreground" title="funded account name">
              → {account.alias}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {account.rules.firm_name} · {account.rules.plan_name}
          </span>
          <Badge variant="outline">{account.state.replace("_", " ")}</Badge>
          {doneToday ? <Chip tone="good">✓ today</Chip> : null}
        </div>

        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold tabular-nums">{usd(account.current_balance)}</span>
          <span className={`tabular-nums ${signClass(delta)}`}>
            {delta >= 0 ? "+" : ""}
            {usd(delta)}
          </span>
          {account.cycle > 1 ? (
            <Chip tone="good">
              cycle {account.cycle} · {usd(account.payout_received)} banked
            </Chip>
          ) : null}
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            Floor <span className="tabular-nums text-foreground">{usd(account.drawdown_floor)}</span>
          </span>
          <span>
            Cushion <span className="tabular-nums text-foreground">{usd(account.risk_budget)}</span>
          </span>
        </div>

        {account.one_loss_ends_it && !account.is_terminal ? (
          <div className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-400">
            ⚠ One loss ends it — cushion {usd(account.risk_budget)}
          </div>
        ) : null}

        {!account.is_terminal &&
          (account.stage === "eval" ? (
            <EvalSection account={account} />
          ) : (
            <FundedSection account={account} />
          ))}

        {actions.length ? <div className="flex flex-wrap gap-1">{actions}</div> : null}
        {children}

        {dayRows.length ? (
          <div className="border-t pt-2">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "▾" : "▸"} {dayRows.length} entries
            </button>
            {open ? (
              <div className="mt-1 space-y-0.5">
                {dayRows.map((r) => (
                  <div key={r.key} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">
                      {r.left} {r.tag ? <span className="opacity-70">{r.tag}</span> : null}
                    </span>
                    <span className={`tabular-nums ${r.cls}`}>{r.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
