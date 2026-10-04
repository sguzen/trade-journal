"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { RuleFields, readRuleForm } from "./campaign-forms";
import { postJson } from "@/lib/use-api";
import { type RuleSet, tmpUrl, usd } from "@/lib/campaign";

const NEW_PLAN_DEFAULTS: Partial<RuleSet> = {
  drawdown_type: "trailing_eod",
  min_profitable_days: 5,
  payout_split_pct: 90,
};

export function FirmPresets({
  presets,
  onChanged,
}: {
  presets: Record<string, RuleSet>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ name: string; rules: Partial<RuleSet> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const name = String(fd.get("__name") ?? "").trim();
    if (!name) return;
    setError(null);
    try {
      await postJson(tmpUrl("firms"), { name, rules: readRuleForm(fd) });
      setEditing(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Delete preset "${name}"?`)) return;
    try {
      await postJson(tmpUrl(`firms/${encodeURIComponent(name)}`), undefined, "DELETE");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Firm plans (presets for new accounts)</h2>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => setEditing({ name: "", rules: NEW_PLAN_DEFAULTS })}
        >
          + New plan
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Editing a preset changes future accounts only — existing accounts keep the rules they were
        bought under. To fix a live account&apos;s rules, use ⚙ on its card.
      </p>

      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {Object.entries(presets).map(([name, r]) => (
          <Card key={name}>
            <CardHeader>
              <CardTitle className="flex items-baseline gap-2 text-base">
                {name}
                <span className="text-xs font-normal text-muted-foreground">{r.firm_name}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  Size <b>{usd(r.account_size)}</b>
                </span>
                <span>
                  Target <b>{usd(r.payout_profit_target)}</b>
                </span>
                <span>
                  Days{" "}
                  <b>
                    {r.min_profitable_days}×{usd(r.min_daily_profit)}
                  </b>
                </span>
                <span>
                  Split <b>{r.payout_split_pct}%</b>
                </span>
                <span>
                  Cap <b>{r.payout_cap ? usd(r.payout_cap) : "—"}</b>
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  DD <b>{usd(r.drawdown_amount)}</b> {r.drawdown_type}
                </span>
                <span>
                  Lock{" "}
                  <b>
                    {r.trail_stops_at_profit == null
                      ? "keeps trailing"
                      : `+${usd(r.trail_stops_at_profit)}`}
                  </b>
                </span>
                <span>
                  Eval <b>{r.eval_profit_target ? usd(r.eval_profit_target) : "—"}</b>
                  {r.consistency_pct_eval ? ` @ ${r.consistency_pct_eval}%` : ""}
                </span>
              </div>
              {r.payout_buffer > 0 || r.funded_drawdown_amount != null || r.funded_drawdown_type ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {r.payout_buffer > 0 ? (
                    <span>
                      Buffer <b>{usd(r.payout_buffer)}</b> then {usd(r.payout_min)}–
                      {usd(r.payout_daily_cap)}/day
                    </span>
                  ) : null}
                  {r.funded_drawdown_amount != null || r.funded_drawdown_type ? (
                    <span>
                      Funded DD <b>{usd(r.funded_drawdown_amount ?? r.drawdown_amount)}</b>{" "}
                      {r.funded_drawdown_type || r.drawdown_type}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing({ name, rules: r })}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 dark:text-red-400"
                  onClick={() => remove(name)}
                >
                  ✕
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editing.name ? `Edit: ${editing.name}` : "New plan"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Preset name
                <Input
                  name="__name"
                  defaultValue={editing.name}
                  readOnly={Boolean(editing.name)}
                  required
                />
              </label>
              <RuleFields rules={editing.rules} />
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  Save plan
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
