"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { type ActionKind } from "./account-card";
import { type CampaignAccount, type RuleSet, usd } from "@/lib/campaign";

/**
 * The 21 fields of a firm rule set, in TMP's own order.
 *
 * `opt` fields must send null when blank, never 0 — "no daily loss limit" and
 * "a daily loss limit of $0" are different rules, and conflating them would
 * silently change what the account is allowed to do.
 */
export const RULE_DEFS: [keyof RuleSet, string, "text" | "num" | "opt" | "ddtype" | "fddtype"][] = [
  ["firm_name", "Firm", "text"],
  ["plan_name", "Plan", "text"],
  ["account_size", "Account size $", "num"],
  ["payout_profit_target", "Payout target $", "num"],
  ["min_profitable_days", "Qualifying days", "num"],
  ["min_daily_profit", "Min daily $", "num"],
  ["payout_split_pct", "Split %", "num"],
  ["payout_cap", "Payout cap $ (0 = none)", "num"],
  ["max_payouts", "Closed after N payouts (0 = never)", "num"],
  ["eval_profit_target", "Eval target $", "num"],
  ["consistency_pct_eval", "Eval consistency % (blank = none)", "opt"],
  ["drawdown_amount", "Drawdown $", "num"],
  ["drawdown_type", "Drawdown type", "ddtype"],
  ["trail_stops_at_profit", "Trail lock at profit $ (blank = keeps trailing)", "opt"],
  ["daily_loss_limit", "Funded DLL $ (blank = none)", "opt"],
  ["consistency_pct_funded", "Funded consistency % (blank = none)", "opt"],
  ["funded_drawdown_amount", "Funded DD $ (blank = same as eval)", "opt"],
  ["funded_drawdown_type", "Funded DD type (blank = same as eval)", "fddtype"],
  ["payout_buffer", "Payout buffer $ (0 = classic cycles)", "num"],
  ["payout_daily_cap", "Max payout / day $ (0 = n/a)", "num"],
  ["payout_min", "Min payout $ (0 = none)", "num"],
];

const DD_TYPES = ["trailing_eod", "trailing", "static"];

export function RuleFields({ rules }: { rules: Partial<RuleSet> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {RULE_DEFS.map(([key, label, kind]) => {
        const value = rules[key];
        return (
          <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {label}
            {kind === "ddtype" || kind === "fddtype" ? (
              <select
                name={key}
                defaultValue={value == null ? "" : String(value)}
                className="h-8 rounded border bg-background px-2 text-sm text-foreground"
              >
                {kind === "fddtype" ? <option value="">same as eval</option> : null}
                {DD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                name={key}
                type={kind === "num" ? "number" : "text"}
                step={kind === "num" ? "any" : undefined}
                defaultValue={value == null ? "" : String(value)}
                className="h-8"
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Mirrors TMP's readRuleForm: blank `opt` fields become null, not 0. */
export const readRuleForm = (fd: FormData): Record<string, unknown> => {
  const rules: Record<string, unknown> = {};
  for (const [key, , kind] of RULE_DEFS) {
    const raw = fd.get(key);
    const value = raw == null ? "" : String(raw);
    if (kind === "opt") rules[key] = value === "" ? null : Number(value);
    else if (kind === "num") rules[key] = Number(value);
    else if (kind === "fddtype") rules[key] = value || null;
    else rules[key] = value;
  }
  return rules;
};

interface FormSpec {
  title: string;
  /** Returns [path, body, method] for the request. */
  submit: (fd: FormData) => [string, unknown, "POST" | "PATCH" | "DELETE"];
  body: React.ReactNode;
  confirm?: string;
}

export function buildForm(
  kind: ActionKind,
  a: CampaignAccount,
  today: string,
  presets: Record<string, RuleSet>,
): FormSpec | null {
  const id = encodeURIComponent(a.account_id);
  const field = (label: string, input: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {input}
    </label>
  );

  switch (kind) {
    case "logday":
      return {
        title: `Log day — ${a.account_id}`,
        body: (
          <>
            {field("Date", <Input name="day" type="date" defaultValue={today} required />)}
            {field("P&L $", <Input name="pnl" type="number" step="0.01" required autoFocus />)}
            {field("Note", <Input name="note" />)}
          </>
        ),
        submit: (fd) => [
          `accounts/${id}/day`,
          { day: fd.get("day"), pnl: Number(fd.get("pnl")), note: fd.get("note") ?? "" },
          "POST",
        ],
      };
    case "pass":
      return {
        title: `Passed → funded — ${a.account_id}`,
        confirm: a.eval?.passable
          ? undefined
          : "Eval progress does not show passable yet. Mark passed anyway?",
        body: field(
          "Funded account name",
          <Input name="alias" defaultValue={a.alias} placeholder="new ID the firm issued" />,
        ),
        submit: (fd) => [`accounts/${id}/pass-eval`, { alias: fd.get("alias") ?? "" }, "POST"],
      };
    case "request":
      return {
        title: `Request payout — ${a.account_id}`,
        body: (
          <>
            {field(
              "Request $",
              <Input
                name="amount"
                type="number"
                step="0.01"
                defaultValue={a.payout?.suggested_request}
                required
              />,
            )}
            <p className="text-xs text-muted-foreground">
              nets ~{usd(a.payout?.suggested_net)} at {a.rules.payout_split_pct}%
            </p>
          </>
        ),
        submit: (fd) => [
          `accounts/${id}/request-payout`,
          { amount: Number(fd.get("amount")) },
          "POST",
        ],
      };
    case "paid": {
      const gross = a.payout_requested_amount || a.payout?.suggested_request || 0;
      const net = (gross * a.rules.payout_split_pct) / 100;
      const n = a.payouts.length + 1;
      return {
        title: `Mark paid — ${a.account_id}`,
        body: (
          <>
            {field(
              "Withdrawn $ (gross)",
              <Input name="gross" type="number" step="0.01" defaultValue={gross.toFixed(2)} required />,
            )}
            {field(
              "Received $ (net)",
              <Input name="net" type="number" step="0.01" defaultValue={net.toFixed(2)} required />,
            )}
            {field("Date", <Input name="day" type="date" defaultValue={today} />)}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="close" /> account closed
            </label>
            {a.rules.max_payouts ? (
              <p className="text-xs text-muted-foreground">
                payout {n} of {a.rules.max_payouts}
                {n >= a.rules.max_payouts ? " — account retires automatically" : ""}
              </p>
            ) : null}
          </>
        ),
        submit: (fd) => [
          `accounts/${id}/paid`,
          {
            gross: Number(fd.get("gross")),
            net: Number(fd.get("net")),
            day: fd.get("day"),
            close: fd.get("close") === "on",
          },
          "POST",
        ],
      };
    }
    case "denied":
      return {
        title: `Payout denied — ${a.account_id}`,
        body: field("Reason", <Input name="reason" placeholder="why?" required autoFocus />),
        submit: (fd) => [`accounts/${id}/denied`, { reason: fd.get("reason") }, "POST"],
      };
    case "fee":
      return {
        title: `Log fee — ${a.account_id}`,
        body: (
          <>
            {field("Amount $", <Input name="amount" type="number" step="0.01" required autoFocus />)}
            {field(
              "Kind",
              <select
                name="kind"
                className="h-9 rounded border bg-background px-2 text-sm text-foreground"
              >
                {["activation", "reset", "data", "other"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>,
            )}
            {field("Date", <Input name="day" type="date" defaultValue={today} />)}
            {field("Note", <Input name="note" />)}
          </>
        ),
        submit: (fd) => [
          `accounts/${id}/fee`,
          {
            amount: Number(fd.get("amount")),
            kind: fd.get("kind"),
            day: fd.get("day"),
            note: fd.get("note") ?? "",
          },
          "POST",
        ],
      };
    case "alias":
      return {
        title: `Alias — ${a.account_id}`,
        body: field("Alias", <Input name="alias" defaultValue={a.alias} autoFocus />),
        submit: (fd) => [`accounts/${id}/alias`, { alias: fd.get("alias") ?? "" }, "PATCH"],
      };
    case "retire": {
      const n = a.payouts.length;
      return {
        title: `Retire — ${a.account_id}`,
        body: field(
          "Why",
          <Input
            name="note"
            defaultValue={n ? `closed by firm after payout ${n}` : "retired by choice"}
          />,
        ),
        submit: (fd) => [`accounts/${id}/retire`, { note: fd.get("note") }, "POST"],
      };
    }
    case "breach":
      return {
        title: `Mark breached — ${a.account_id}`,
        confirm: `Close ${a.account_id} as BREACHED? This is terminal.`,
        body: <p className="text-xs text-muted-foreground">This closes the account as blown.</p>,
        submit: () => [`accounts/${id}/breach`, {}, "POST"],
      };
    case "delete":
      return {
        title: `Delete — ${a.account_id}`,
        confirm:
          `Delete ${a.account_id} entirely? Its logged days go too. This is for data-entry ` +
          `mistakes — a blown account should be "mark breached" so stats stay honest.`,
        body: <p className="text-xs text-muted-foreground">Permanent.</p>,
        submit: () => [`accounts/${id}`, undefined, "DELETE"],
      };
    case "rules":
      return {
        title: `Rule snapshot — ${a.account_id}`,
        body: <RulesEditorBody rules={a.rules} presets={presets} />,
        submit: (fd) => [`accounts/${id}/rules`, { rules: readRuleForm(fd) }, "PATCH"],
      };
    default:
      return null;
  }
}

/** Rule editor with TMP's "copy values from preset" helper. */
function RulesEditorBody({
  rules,
  presets,
}: {
  rules: RuleSet;
  presets: Record<string, RuleSet>;
}) {
  const names = Object.keys(presets);
  const [source, setSource] = useState(names[0] ?? "");
  const fill = () => {
    const preset = presets[source];
    if (!preset) return;
    const form = document.getElementById("campaign-action-form") as HTMLFormElement | null;
    if (!form) return;
    for (const [key] of RULE_DEFS) {
      const input = form.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement | null;
      if (!input) continue;
      const value = preset[key];
      input.value = value == null ? "" : String(value);
    }
  };
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Changes are logged to the account history. Editing here affects this account only.
      </p>
      {names.length ? (
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Copy values from preset
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="h-8 rounded border bg-background px-2 text-sm text-foreground"
            >
              {names.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={fill}>
            ← Fill form
          </Button>
        </div>
      ) : null}
      <RuleFields rules={rules} />
    </>
  );
}
