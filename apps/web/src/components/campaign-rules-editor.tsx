"use client";

/**
 * The rules editor, for plans no preset covers.
 *
 * Every money field is blank-able, and blank means different things by field:
 * for a nullable one it means the plan HAS no such rule, which is not the same
 * as a rule set to zero. A plan with no daily loss limit and a plan with a $0
 * one behave completely differently, so the form keeps them apart and says so
 * rather than quietly coercing one into the other.
 */

import { useState } from "react";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { OptionSelect } from "./ui/option-select";

export interface RulesInput {
  payoutProfitTarget: number;
  minProfitableDays: number;
  minDailyProfit: number;
  payoutSplitPct: number;
  evalProfitTarget: number;
  consistencyPctEval: number | null;
  consistencyPctFunded: number | null;
  dailyLossLimit: number | null;
  drawdownAmount: number;
  drawdownType: string;
  trailStopsAtProfit: number | null;
  fundedDrawdownAmount: number | null;
  fundedDrawdownType: string | null;
  payoutCap: number;
  payoutBuffer: number;
  payoutDailyCap: number;
  payoutMin: number;
  maxPayouts: number;
  payoutLifetimeCap: number;
}

const DRAWDOWN_LABELS: Record<string, string> = {
  static: "Static — fixed at start − amount",
  trailing_eod: "Trailing, end of day",
  trailing: "Trailing, intraday",
};

type FieldKey = keyof RulesInput;
type Draft = Record<FieldKey, string>;

const toDraft = (rules: RulesInput): Draft =>
  Object.fromEntries(
    Object.entries(rules).map(([key, value]) => [key, value === null ? "" : String(value)]),
  ) as Draft;

/** Blank stays blank: it is the caller's job to decide whether that is legal. */
const num = (raw: string): number | null => {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : NaN;
};

export function RulesEditor({
  accountId,
  label,
  initial,
  onSaved,
  onCancel,
}: {
  accountId: string;
  label: string;
  initial: RulesInput;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (key: FieldKey, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const money = (key: FieldKey, title: string, hint?: string) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{title}</span>
      <Input
        inputMode="decimal"
        value={draft[key]}
        onChange={(event) => set(key, event.target.value)}
        aria-label={title}
      />
      {hint && <span className="text-[11px]">{hint}</span>}
    </label>
  );

  const save = async () => {
    // A required field left blank is a mistake worth naming, not a zero.
    const required: FieldKey[] = [
      "payoutProfitTarget",
      "minProfitableDays",
      "minDailyProfit",
      "payoutSplitPct",
      "evalProfitTarget",
      "drawdownAmount",
      "payoutCap",
      "payoutBuffer",
      "payoutDailyCap",
      "payoutMin",
      "maxPayouts",
      "payoutLifetimeCap",
    ];
    const rules: Record<string, unknown> = { drawdownType: draft.drawdownType };
    for (const key of required) {
      const value = num(draft[key]);
      if (value === null || Number.isNaN(value)) {
        setError(`Enter a number for "${key}". Use 0 for none.`);
        return;
      }
      rules[key] = value;
    }
    for (const key of [
      "consistencyPctEval",
      "consistencyPctFunded",
      "dailyLossLimit",
      "trailStopsAtProfit",
      "fundedDrawdownAmount",
    ] as FieldKey[]) {
      const value = num(draft[key]);
      if (Number.isNaN(value)) {
        setError(`"${key}" must be a number, or blank for none.`);
        return;
      }
      rules[key] = value;
    }
    rules.fundedDrawdownType = draft.fundedDrawdownType === "" ? null : draft.fundedDrawdownType;

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rules", accountId, rules }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Could not save these rules.");
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save these rules.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">Rules — {label}</p>
      <p className="text-xs text-muted-foreground">
        Blank means <em>no such rule</em> on the four optional fields below, which is not the same
        as zero: a plan with no daily loss limit behaves nothing like one with a $0 limit. Use 0 on
        the rest to mean none.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {money("evalProfitTarget", "Evaluation target")}
        {money("drawdownAmount", "Drawdown")}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>Drawdown type</span>
          <OptionSelect
            value={draft.drawdownType}
            onValueChange={(value) => set("drawdownType", value)}
            aria-label="Drawdown type"
          >
            {Object.entries(DRAWDOWN_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </OptionSelect>
        </label>
        {money("trailStopsAtProfit", "Trailing locks at", "blank = never locks")}

        {money("fundedDrawdownAmount", "Funded drawdown", "blank = same as above")}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>Funded drawdown type</span>
          <OptionSelect
            value={draft.fundedDrawdownType}
            onValueChange={(value) => set("fundedDrawdownType", value)}
            aria-label="Funded drawdown type"
          >
            <option value="">Same as the evaluation</option>
            {Object.entries(DRAWDOWN_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </OptionSelect>
        </label>
        {money("dailyLossLimit", "Daily loss limit", "blank = none")}
        {money("consistencyPctEval", "Eval consistency %", "blank = none")}

        {money("consistencyPctFunded", "Funded consistency %", "blank = none")}
        {money("payoutProfitTarget", "Payout target")}
        {money("minProfitableDays", "Qualifying days")}
        {money("minDailyProfit", "Qualifying day minimum")}

        {money("payoutSplitPct", "Split %")}
        {money("payoutCap", "Payout cap", "0 = uncapped")}
        {money("payoutBuffer", "Buffer left in", "0 = none")}
        {money("payoutMin", "Minimum payout", "0 = none")}

        {money("payoutDailyCap", "Daily payout cap", "0 = not daily")}
        {money("maxPayouts", "Account ends after N payouts", "0 = never")}
        {money("payoutLifetimeCap", "Lifetime withdrawal cap", "0 = none")}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          Save rules
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
