"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { AccountCard, type ActionKind } from "./account-card";
import { BudgetEditor, BulkFailedDialog, NewAccountDialog } from "./account-dialogs";
import { buildForm } from "./campaign-forms";
import { ByFirmTable, ByPlanTable, ClosedTable } from "./campaign-tables";
import { AnalyticsView, CalendarView, PlanView } from "./campaign-views";
import { EvalCalcView } from "./eval-calc";
import { FirmPresets } from "./firm-presets";
import { postJson, useApi } from "@/lib/use-api";
import {
  type CampaignAccount,
  type CampaignState,
  rateWithN,
  signClass,
  tmpUrl,
  usd,
} from "@/lib/campaign";

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${cls ?? ""}`}>{value}</div>
    </div>
  );
}

export function Campaign() {
  const { data, error, refresh } = useApi<CampaignState>(tmpUrl("state"));
  const [stage, setStage] = useState<"all" | "eval" | "funded">("all");
  const [action, setAction] = useState<{ kind: ActionKind; account: CampaignAccount } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (error)
    return (
      <div className="p-6">
        <p className="text-sm text-red-600 dark:text-red-400">
          Trading Manager Pro is not reachable: {error}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          The campaign data lives in TMP. Check that the <code>tmp</code> service is running.
        </p>
      </div>
    );
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Loading campaign…</div>;

  const { stats, budget } = data;
  const active = data.accounts.filter((a) => !a.is_terminal);
  const counts = {
    all: active.length,
    eval: active.filter((a) => a.stage === "eval").length,
    funded: active.filter((a) => a.stage === "funded").length,
  };
  const doneToday = (a: CampaignAccount) =>
    !a.is_terminal && a.days.some((d) => d.day === data.today);
  const shown = (stage === "all" ? active : active.filter((a) => a.stage === stage))
    .slice()
    // Accounts still needing a result today come first.
    .sort((x, y) => Number(doneToday(x)) - Number(doneToday(y)));

  const spec = action ? buildForm(action.kind, action.account, data.today, data.presets) : null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!spec) return;
    const [path, body, method] = spec.submit(new FormData(event.currentTarget));
    setBusy(true);
    setFormError(null);
    try {
      await postJson(tmpUrl(path), body, method);
      setAction(null);
      refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const onAction = (kind: ActionKind, account: CampaignAccount) => {
    const next = buildForm(kind, account, data.today, data.presets);
    if (next?.confirm && !window.confirm(next.confirm)) return;
    setFormError(null);
    setAction({ kind, account });
  };

  const deleteAccount = async (id: string) => {
    if (!window.confirm(`Delete ${id} entirely? Its logged days go too.`)) return;
    try {
      await postJson(tmpUrl(`accounts/${encodeURIComponent(id)}`), undefined, "DELETE");
      refresh();
    } catch {
      /* surfaced on next refresh */
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Net" value={usd(stats.net)} cls={signClass(stats.net)} />
        {/* No N here: ROI is received ÷ spent, a ratio of two known amounts.
            Rule 3 covers rates over trials — win rate, expectancy, probability —
            and tagging a sample size onto a deterministic ratio would imply a
            sampling claim that does not exist. */}
        <Stat
          label="ROI"
          value={`${stats.roi_pct.toFixed(0)}%`}
          cls={signClass(stats.roi_pct)}
        />
        <Stat label="Deployed" value={usd(stats.total_spent)} />
        <Stat label="Received" value={usd(stats.total_received)} />
        <Stat label="In flight" value={String(stats.in_flight)} />
        <Stat
          label="Pass rate"
          value={rateWithN(stats.pass_rate_pct, stats.eval_attempts_resolved)}
        />
        <Stat
          label="Realised"
          value={rateWithN(stats.payout_realisation_pct, stats.payout_attempts)}
        />
        <div className="relative">
        <Stat
          label={`${budget.month} spend`}
          value={
            budget.monthly_eval_budget
              ? `${usd(budget.month_spend)} / ${usd(budget.monthly_eval_budget)}`
              : `${usd(budget.month_spend)} / set`
          }
          cls={budget.over ? signClass(-1) : budget.warn ? "text-amber-600 dark:text-amber-400" : ""}
        />
        <BudgetEditor current={budget.monthly_eval_budget} onSaved={refresh} />
        </div>
      </div>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="evalcalc">Eval calc</TabsTrigger>
          <TabsTrigger value="firms">Firm plans</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Active accounts</h2>
            <NewAccountDialog presets={data.presets} onSaved={refresh} />
            <BulkFailedDialog presets={data.presets} onSaved={refresh} />
            <div className="ml-auto flex gap-1">
              {(["all", "eval", "funded"] as const).map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant={stage === key ? "default" : "ghost"}
                  onClick={() => setStage(key)}
                >
                  {key === "all" ? "All" : key === "eval" ? "Evals" : "Funded"} ({counts[key]})
                </Button>
              ))}
            </div>
          </div>

          {shown.length ? (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {shown.map((a) => (
                <AccountCard
                  key={a.account_id}
                  account={a}
                  today={data.today}
                  onAction={onAction}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No {stage === "all" ? "live" : stage} accounts.
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By plan — what to buy next</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <ByPlanTable byPlan={data.by_plan} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By firm</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <ByFirmTable byFirm={data.by_firm} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Closed accounts</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <ClosedTable accounts={data.accounts} onDelete={deleteAccount} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <CalendarView today={data.today} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="analytics">
          <AnalyticsView />
        </TabsContent>
        <TabsContent value="plan">
          <PlanView />
        </TabsContent>
        <TabsContent value="evalcalc">
          <EvalCalcView />
        </TabsContent>
        <TabsContent value="firms">
          <FirmPresets presets={data.presets} onChanged={refresh} />
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(action)} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{spec?.title}</DialogTitle>
          </DialogHeader>
          {spec ? (
            <form id="campaign-action-form" onSubmit={submit} className="space-y-3">
              {spec.body}
              {formError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setAction(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
