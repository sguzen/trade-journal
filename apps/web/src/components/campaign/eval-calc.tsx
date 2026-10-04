"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { postJson, useApi } from "@/lib/use-api";
import { tmpUrl } from "@/lib/campaign";

/**
 * Monte Carlo eval calculator.
 *
 * Every number here is produced by TMP's simulation engine — this component
 * only collects the configuration and renders the result. The pass rate and
 * funded rate are shown with the confidence intervals the engine returns,
 * never as bare percentages.
 */

type Cfg = Record<string, string | number | boolean>;

const DEFAULT_CFG: Cfg = {
  source: "mid2mid",
  win_p: 0.5,
  rrr: 1.5,
  tpd: 2,
  risk: 300,
  target: 3000,
  dd: 2000,
  dd_type: "eod_trail",
  cons_cap: 50,
  max_days: 90,
  fee_initial: 119,
  fee_retry: 49,
  fee_monthly: 0,
  fee_activation: 0,
  sims: 600,
  risk_f: 300,
  f_dd: 2000,
  f_dd_type: "eod_trail",
  f_cons_cap: 0,
  lock_at_profit: 100,
  max_attempts: 10,
  cycle_target: 1000,
  min_days: 5,
  min_day_profit: 100,
  payout_cap: 1000,
  split: 0.9,
  withdraw_frac: 0.5,
  max_funded_days: 250,
  withdraw_policy: "earliest",
  buffer_target: 0,
  max_cycles: 3,
  dll: 0,
  f_dll: 0,
  dll_evaluation: "intraday",
  min_trading_days: 0,
  payout_frequency: "on-demand",
  first_payout_min_days: 0,
  refundable_on_pass: false,
};

interface EvalResult {
  pass_rate_pct: number;
  pass_rate_ci?: [number, number];
  e_attempts: number;
  e_cost: number;
  days_to_funded_p50: number;
  e_banked?: number | null;
  banked_p50?: number;
  p_any_payout_pct?: number;
  first_payout_day_p50?: number | null;
  roi_multiple?: number;
  engine_version?: string;
  attempts_observed?: number;
  sims?: number;
  fail_reasons_pct?: Record<string, number>;
  avg_days_when_passed?: number | null;
  avg_days_when_failed?: number | null;
  stagnation_days?: { p50?: number; p90?: number };
  attempts?: { p50?: number; p90?: number };
  max_dd_eval_p50?: number;
  max_dd_eval_p95?: number;
  cost_p95?: number;
  cost_given_funded_p50?: number;
  funded_rate_pct?: number;
  funded_rate_ci?: [number, number];
  funded_blown_pct?: number;
  avg_payout_events?: number;
  ev_total?: number;
  ev_se?: number;
  p_ev_positive_pct?: number;
  rules_text?: string[];
  flags_not_simulated?: { id: string; detail: string }[];
}

interface SavedSet {
  id: string;
  name: string;
  cfg: Cfg;
  last_result?: EvalResult;
}

interface FirmTemplate {
  name: string;
  [key: string]: unknown;
}

const NUM = (v: unknown) => (typeof v === "number" ? v : Number(v));

function Num({
  cfg,
  set,
  k,
  label,
  step = 1,
  scale = 1,
}: {
  cfg: Cfg;
  set: (k: string, v: number) => void;
  k: string;
  label: string;
  step?: number;
  scale?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        step={step}
        className="h-8 w-28"
        value={Number((NUM(cfg[k]) * scale).toFixed(4))}
        onChange={(e) => set(k, Number(e.target.value) / scale)}
      />
    </label>
  );
}

function Pick({
  cfg,
  set,
  k,
  label,
  options,
}: {
  cfg: Cfg;
  set: (k: string, v: string) => void;
  k: string;
  label: string;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        className="h-8 rounded border bg-background px-2 text-sm text-foreground"
        value={String(cfg[k])}
        onChange={(e) => set(k, e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="max-w-4xl text-xs text-muted-foreground">{help}</p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">{children}</CardContent>
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function EvalCalcView() {
  const [cfg, setCfg] = useState<Cfg>(DEFAULT_CFG);
  const [result, setResult] = useState<EvalResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  const presets = useApi<SavedSet[]>(tmpUrl("eval-calc/presets"));
  const templates = useApi<FirmTemplate[]>(tmpUrl("eval-calc/firm-templates"));
  const [savedSets, setSavedSets] = useState<SavedSet[]>([]);
  useEffect(() => {
    if (presets.data) setSavedSets(presets.data);
  }, [presets.data]);

  const set = (k: string, v: string | number | boolean) => setCfg((c) => ({ ...c, [k]: v }));

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await postJson<EvalResult>(tmpUrl("eval-calc/run"), cfg));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Run failed");
    } finally {
      setBusy(false);
    }
  };

  const saveSet = async () => {
    if (!name.trim()) return;
    try {
      await postJson(tmpUrl("eval-calc/presets"), { name: name.trim(), cfg, last_result: result });
      setName("");
      presets.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    }
  };

  const applyTemplate = (index: string) => {
    const t = templates.data?.[Number(index)];
    if (!t) return;
    const next: Cfg = { ...cfg };
    for (const [k, v] of Object.entries(t)) {
      if (k === "name") continue;
      if (k in DEFAULT_CFG && (typeof v === "number" || typeof v === "string"))
        next[k] = v as string | number;
    }
    setCfg(next);
  };

  const r = result;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Eval-account calculator</h2>
        <p className="text-xs text-muted-foreground">
          Bootstrap of audited trade sequences through firm rules (day blocks, streaks preserved).
          Every figure is computed by TMP&apos;s engine.
        </p>
      </div>

      <Section
        title="1 · What's being traded"
        help="mid2mid / 123-CSD replay the desk's m1-audited trade sequences. synthetic generates trades from the win% / RRR / trades-per-day you type. coin is the zero-edge baseline: win% is forced to 1/(1+RRR) so expectancy is zero."
      >
        <Pick
          cfg={cfg}
          set={set}
          k="source"
          label="source"
          options={[
            ["mid2mid", "mid2mid"],
            ["123-CSD", "123-CSD"],
            ["synthetic", "synthetic"],
            ["coin", "coin"],
          ]}
        />
        <Num cfg={cfg} set={set} k="win_p" label="win % (synthetic only)" scale={100} />
        <Num cfg={cfg} set={set} k="rrr" label="RRR" step={0.1} />
        <Num cfg={cfg} set={set} k="tpd" label="trades/day" step={0.5} />
        <Num cfg={cfg} set={set} k="risk" label="risk $/trade" />
      </Section>

      <Section
        title="2 · Account rules"
        help="EOD trailing ratchets the loss floor on end-of-day peaks and locks at breakeven; intraday trailing ratchets on open-trade highs — the harshest type. Consistency cap = best day must stay ≤ X × total profit."
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          firm template
          <select
            className="h-8 rounded border bg-background px-2 text-sm text-foreground"
            onChange={(e) => applyTemplate(e.target.value)}
            defaultValue=""
          >
            <option value="">— custom —</option>
            {(templates.data ?? []).map((t, i) => (
              <option key={t.name} value={i}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <Num cfg={cfg} set={set} k="target" label="profit target $" />
        <Num cfg={cfg} set={set} k="dd" label="max DD $" />
        <Pick
          cfg={cfg}
          set={set}
          k="dd_type"
          label="DD type"
          options={[
            ["static", "static"],
            ["eod_trail", "EOD trailing"],
            ["intraday_trail", "intraday trailing"],
          ]}
        />
        <Num cfg={cfg} set={set} k="cons_cap" label="consistency cap % (0=off)" step={5} />
        <Num cfg={cfg} set={set} k="max_days" label="max days" />
        <Num cfg={cfg} set={set} k="dll" label="daily loss $ (0=none)" />
        <Pick
          cfg={cfg}
          set={set}
          k="dll_evaluation"
          label="DLL check"
          options={[
            ["intraday", "intraday (open P&L counts)"],
            ["end-of-day", "end of day"],
          ]}
        />
        <Num cfg={cfg} set={set} k="min_trading_days" label="min trading days" />
      </Section>

      <Section
        title="3 · Funded phase & payouts"
        help="Runs after every simulated pass. Each payout takes withdraw-fraction × cushion up to the cap, keeps split × that, and the cushion drops by the gross — which is why accounts often die right after a withdrawal."
      >
        <Num cfg={cfg} set={set} k="risk_f" label="funded risk $/trade" />
        <Num cfg={cfg} set={set} k="f_dd" label="funded max DD $" />
        <Pick
          cfg={cfg}
          set={set}
          k="f_dd_type"
          label="funded DD type"
          options={[
            ["static", "static"],
            ["eod_trail", "EOD trailing"],
            ["intraday_trail", "intraday trailing"],
          ]}
        />
        <Num cfg={cfg} set={set} k="f_cons_cap" label="funded consistency % (0=off)" step={5} />
        <Num cfg={cfg} set={set} k="cycle_target" label="cycle target $" />
        <Num cfg={cfg} set={set} k="min_days" label="min profitable days" />
        <Num cfg={cfg} set={set} k="min_day_profit" label="min $/day to count" />
        <Num cfg={cfg} set={set} k="payout_cap" label="payout cap $ (0=none)" />
        <Num cfg={cfg} set={set} k="split" label="split %" step={5} scale={100} />
        <Num cfg={cfg} set={set} k="withdraw_frac" label="withdraw % of cushion" step={5} scale={100} />
        <Pick
          cfg={cfg}
          set={set}
          k="withdraw_policy"
          label="withdraw policy"
          options={[
            ["earliest", "earliest eligible"],
            ["wait_cap", "wait until cap-size"],
            ["buffer", "build buffer first"],
          ]}
        />
        <Num cfg={cfg} set={set} k="buffer_target" label="buffer target $" />
        <Num cfg={cfg} set={set} k="max_cycles" label="max payout cycles (0=∞)" />
        <Num cfg={cfg} set={set} k="lock_at_profit" label="floor locks at start+$" />
        <Num cfg={cfg} set={set} k="max_funded_days" label="funded day horizon" />
        <Num cfg={cfg} set={set} k="f_dll" label="funded daily loss $ (0=none)" />
        <Pick
          cfg={cfg}
          set={set}
          k="payout_frequency"
          label="payout frequency"
          options={[
            ["on-demand", "on-demand"],
            ["weekly", "weekly"],
            ["biweekly", "biweekly"],
            ["monthly", "monthly"],
          ]}
        />
        <Num cfg={cfg} set={set} k="first_payout_min_days" label="first payout after N days" />
      </Section>

      <Section
        title="4 · Fees"
        help="Initial is paid once per campaign, retry per failed attempt, monthly accrues per 21 trading days across all attempts, activation once on pass."
      >
        <Num cfg={cfg} set={set} k="fee_initial" label="initial $" />
        <Num cfg={cfg} set={set} k="fee_retry" label="retry $" />
        <Num cfg={cfg} set={set} k="fee_monthly" label="monthly $" />
        <Num cfg={cfg} set={set} k="fee_activation" label="activation $" />
        <Num cfg={cfg} set={set} k="max_attempts" label="give up after N attempts" />
        <Pick
          cfg={cfg}
          set={set}
          k="refundable_on_pass"
          label="fee refunded on pass"
          options={[
            ["false", "no"],
            ["true", "yes"],
          ]}
        />
        <Num cfg={cfg} set={set} k="sims" label="paths" step={100} />
      </Section>

      <div className="flex flex-wrap items-end gap-2">
        <Button onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run simulation"}
        </Button>
        <Input
          placeholder="name this set"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-56"
        />
        <Button variant="ghost" onClick={saveSet} disabled={!name.trim()}>
          Save set
        </Button>
        {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
      </div>

      {r ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Stat
              value={
                r.pass_rate_ci
                  ? `${r.pass_rate_pct}% (${r.pass_rate_ci[0]}–${r.pass_rate_ci[1]})`
                  : `${r.pass_rate_pct}%`
              }
              label="pass rate / attempt"
            />
            <Stat value={String(r.e_attempts)} label="expected attempts" />
            <Stat value={`$${r.e_cost}`} label="expected fees total" />
            <Stat value={`${r.days_to_funded_p50}d`} label="median days: buy → 1st payout" />
            {r.e_banked != null ? (
              <>
                <Stat value={`$${r.e_banked}`} label="expected banked" />
                <Stat value={`$${r.banked_p50 ?? 0}`} label="median banked" />
                <Stat value={`${r.p_any_payout_pct ?? 0}%`} label="chance of ≥1 payout" />
                <Stat
                  value={r.first_payout_day_p50 != null ? `${r.first_payout_day_p50}d` : "—"}
                  label="median days to 1st payout"
                />
                <Stat value={`${r.roi_multiple}x`} label="ROI — banked ÷ fees" />
              </>
            ) : null}
          </div>

          {r.engine_version ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Envelope{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · engine {r.engine_version} · {r.attempts_observed} attempts observed ·{" "}
                    {r.sims} paths
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
                <span>
                  Pass / attempt <b>{r.pass_rate_pct}%</b>{" "}
                  <span className="text-muted-foreground">
                    ({r.pass_rate_ci?.[0]}–{r.pass_rate_ci?.[1]})
                  </span>
                </span>
                <span>
                  Fails{" "}
                  <b>
                    {Object.entries(r.fail_reasons_pct ?? {})
                      .map(([k, v]) => `${k} ${v}%`)
                      .join(" · ")}
                  </b>
                </span>
                <span>
                  Days passed / failed{" "}
                  <b>
                    {r.avg_days_when_passed ?? "—"} / {r.avg_days_when_failed ?? "—"}
                  </b>
                </span>
                <span>
                  Stagnation p50 / p90{" "}
                  <b>
                    {r.stagnation_days?.p50 ?? "—"}d / {r.stagnation_days?.p90 ?? "—"}d
                  </b>
                </span>
                <span>
                  Attempts p50 / p90{" "}
                  <b>
                    {r.attempts?.p50 ?? "—"} / {r.attempts?.p90 ?? "—"}
                  </b>
                </span>
                <span>
                  Max DD evaluating p50 / p95{" "}
                  <b>
                    ${r.max_dd_eval_p50 ?? "—"} / ${r.max_dd_eval_p95 ?? "—"}
                  </b>
                </span>
                <span>
                  Cost p95 <b>${r.cost_p95 ?? "—"}</b> · given funded p50{" "}
                  <b>${r.cost_given_funded_p50 ?? "—"}</b>
                </span>
                <span>
                  Funded <b>{r.funded_rate_pct}%</b>{" "}
                  <span className="text-muted-foreground">
                    ({r.funded_rate_ci?.[0]}–{r.funded_rate_ci?.[1]})
                  </span>{" "}
                  · blown in horizon <b>{r.funded_blown_pct}%</b> · payouts/path{" "}
                  <b>{r.avg_payout_events}</b>
                </span>
                <span>
                  EV{" "}
                  <b className={(r.ev_total ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}>
                    ${r.ev_total}
                  </b>{" "}
                  ± {r.ev_se} · P(EV&gt;0) <b>{r.p_ev_positive_pct}%</b>
                </span>

                {r.rules_text?.length ? (
                  <details className="w-full">
                    <summary className="cursor-pointer text-muted-foreground">
                      effective ruleset
                    </summary>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {r.rules_text.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <details className="w-full">
                  <summary className="cursor-pointer text-muted-foreground">
                    not simulated / assumptions ({(r.flags_not_simulated ?? []).length})
                  </summary>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {(r.flags_not_simulated ?? []).map((f) => (
                      <li key={f.id}>
                        <b>{f.id}</b> — {f.detail}
                      </li>
                    ))}
                  </ul>
                </details>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved sets</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {savedSets.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Set</TableHead>
                  <TableHead>Config</TableHead>
                  <TableHead className="text-right">Pass</TableHead>
                  <TableHead className="text-right">E[fees]</TableHead>
                  <TableHead className="text-right">E[banked]</TableHead>
                  <TableHead className="text-right">ROI</TableHead>
                  <TableHead className="text-right">Median days</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {savedSets.map((p) => {
                  const lr = p.last_result ?? ({} as EvalResult);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {String(p.cfg.source)} · ${String(p.cfg.risk)}/trade ·{" "}
                        {String(p.cfg.dd_type)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lr.pass_rate_pct != null ? `${lr.pass_rate_pct}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lr.e_cost != null ? `$${lr.e_cost}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lr.e_banked != null ? `$${lr.e_banked}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lr.roi_multiple != null ? `${lr.roi_multiple}x` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lr.days_to_funded_p50 != null ? `${lr.days_to_funded_p50}d` : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => {
                              setCfg(p.cfg);
                              setResult(p.last_result ?? null);
                            }}
                          >
                            load
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-red-600 dark:text-red-400"
                            onClick={async () => {
                              await postJson(
                                tmpUrl(`eval-calc/presets/${encodeURIComponent(p.id)}`),
                                undefined,
                                "DELETE",
                              );
                              presets.refresh();
                            }}
                          >
                            ✕
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="p-3 text-sm text-muted-foreground">No saved sets yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
