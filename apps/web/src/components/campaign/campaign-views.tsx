"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { ChartFrame } from "../charts/chart-frame";
import { DailyBars } from "../charts/daily-bars";
import { EquityArea } from "../charts/equity-area";
import { tooltipStyle, useVizTokens } from "../charts/tokens";
import { useApi } from "@/lib/use-api";
import { postJson } from "@/lib/use-api";
import { type AnalyticsData, type CalendarData, signClass, tmpUrl, usd } from "@/lib/campaign";

/* ── Calendar ────────────────────────────────────────────────────────────── */

export function CalendarView({ today, onChanged }: { today: string; onChanged: () => void }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, refresh } = useApi<CalendarData>(tmpUrl(`campaign/calendar?month=${month}`));

  /** "YYYY-MM" → numeric parts; the state is always written in that shape. */
  const parseMonth = (value: string): [number, number] => {
    const [y = "1970", m = "01"] = value.split("-");
    return [Number(y), Number(m)];
  };

  const cells = useMemo(() => {
    const [y, m] = parseMonth(month);
    const startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { startDow, dim, y, m };
  }, [month]);

  const step = (delta: number) => {
    const [y, m] = parseMonth(month);
    setMonth(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
    setSelected(null);
  };

  if (error) return <p className="p-3 text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="p-3 text-sm text-muted-foreground">Loading calendar…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => step(-1)}>
          ‹
        </Button>
        <h2 className="text-lg font-semibold">
          {new Date(cells.y, cells.m - 1).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <Button size="sm" variant="ghost" onClick={() => step(1)}>
          ›
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
          <div key={w} className="p-1 text-center text-xs text-muted-foreground">
            {w}
          </div>
        ))}
        {Array.from({ length: cells.startDow }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {Array.from({ length: cells.dim }, (_, i) => {
          const dd = i + 1;
          const iso = `${month}-${String(dd).padStart(2, "0")}`;
          const rows = data.days[iso] ?? [];
          const pays = data.payout_days[iso] ?? [];
          const total = rows.reduce((s, r) => s + r.pnl, 0);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setSelected(iso)}
              className={`min-h-20 rounded border p-1 text-left align-top text-xs ${
                selected === iso ? "ring-2 ring-primary" : ""
              } ${
                rows.length
                  ? total > 0
                    ? "bg-emerald-500/10"
                    : total < 0
                      ? "bg-red-500/10"
                      : ""
                  : ""
              }`}
            >
              <span className="text-muted-foreground">{dd}</span>
              {rows.length ? (
                <span className={`block tabular-nums ${signClass(total)}`}>{usd(total)}</span>
              ) : null}
              {rows.slice(0, 3).map((r) => (
                <span key={r.account_id} className="block truncate opacity-70">
                  {r.account_id} {r.pnl >= 0 ? "+" : "−"}
                  {Math.abs(Math.round(r.pnl))}
                </span>
              ))}
              {pays.map((p) => (
                <span
                  key={p.account_id}
                  className="block truncate text-emerald-600 dark:text-emerald-400"
                >
                  💰 {p.account_id} {usd(p.net)}
                </span>
              ))}
            </button>
          );
        })}
      </div>

      {selected ? (
        <DayBatchPanel
          iso={selected}
          data={data}
          onSaved={() => {
            refresh();
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

/** Log every active account for one day in a single pass, as TMP does. */
function DayBatchPanel({
  iso,
  data,
  onSaved,
}: {
  iso: string;
  data: CalendarData;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = Object.fromEntries((data.days[iso] ?? []).map((r) => [r.account_id, r]));

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      for (const id of data.active) {
        const value = fd.get(`pnl:${id}`);
        if (value === "" || value == null) continue;
        await postJson(tmpUrl(`accounts/${encodeURIComponent(id)}/day`), {
          day: iso,
          pnl: Number(value),
          note: fd.get(`note:${id}`) ?? "",
        });
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{iso} — log all accounts</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-2">
          {data.active.map((id) => (
            <div key={id} className="grid grid-cols-[1fr_7rem_1fr] items-center gap-2">
              <span className="text-sm font-medium">{id}</span>
              <Input
                name={`pnl:${id}`}
                type="number"
                step="0.01"
                defaultValue={existing[id]?.pnl ?? ""}
                placeholder="—"
                className="h-8"
              />
              <Input
                name={`note:${id}`}
                defaultValue={existing[id]?.note ?? ""}
                className="h-8"
              />
            </div>
          ))}
          {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Save day"}
            </Button>
            <span className="text-xs text-muted-foreground">
              empty P&amp;L = not traded / unchanged
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Analytics ───────────────────────────────────────────────────────────── */

/**
 * Built on the journal's existing Recharts components and design tokens
 * rather than new chart code: EquityArea with a stepped curve is exactly the
 * cashflow shape TMP draws by hand, and DailyBars is its daily P&L chart.
 */
export function AnalyticsView() {
  const tokens = useVizTokens();
  const { data, error } = useApi<AnalyticsData>(tmpUrl("campaign/analytics"));
  if (error) return <p className="p-3 text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="p-3 text-sm text-muted-foreground">Loading analytics…</p>;

  const cashflow = (data.cashflow ?? []).map((p) => ({ t: p.date, cumNetPnl: p.cum }));
  const daily = (data.daily ?? []).map((p) => ({ date: p.date, netPnl: p.pnl }));

  // Five fixed slots, no hue cycling — same rule TMP uses.
  const ids = (data.active ?? Object.keys(data.per_account))
    .filter((id) => (data.per_account[id] ?? []).length)
    .slice(0, 5);
  const folded =
    (data.active ?? []).filter((id) => (data.per_account[id] ?? []).length).length - ids.length;

  const dates = [
    ...new Set(ids.flatMap((id) => (data.per_account[id] ?? []).map((p) => p.date))),
  ].sort();
  const merged = dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const id of ids)
      row[id] = data.per_account[id]?.find((p) => p.date === date)?.cum ?? null;
    return row;
  });
  // The journal's categorical slots, reused so Campaign matches every other
  // multi-series chart in the app.
  const palette = tokens?.series ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business cashflow (costs out, payouts in)</CardTitle>
          </CardHeader>
          <CardContent>
            <EquityArea data={cashflow} height={220} curve="stepAfter" valueLabel="Cumulative" />
            <p className="mt-2 text-xs text-muted-foreground">
              Each step is a purchase (down) or a received payout (up) — the campaign is above
              water when the line is above zero.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily campaign P&amp;L (all accounts)</CardTitle>
          </CardHeader>
          <CardContent>
            <DailyBars data={daily} height={220} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cumulative P&amp;L per account</CardTitle>
        </CardHeader>
        <CardContent>
          {merged.length && tokens ? (
            <>
              <div className="mb-2 flex flex-wrap gap-3 text-xs">
                {ids.map((id, i) => (
                  <span key={id} className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: palette[i] }}
                    />
                    {id}
                  </span>
                ))}
                {folded > 0 ? (
                  <span className="text-muted-foreground">+{folded} more not shown</span>
                ) : null}
              </div>
              <ChartFrame height={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={merged} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={tokens.gridline} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: tokens.inkMuted, fontSize: 11 }}
                      tickLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fill: tokens.inkMuted, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tickFormatter={(v: number) => usd(v)}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle(tokens)}
                      formatter={(value) => usd(Number(value))}
                    />
                    {ids.map((id, i) => (
                      <Line
                        key={id}
                        type="monotone"
                        dataKey={id}
                        stroke={palette[i]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No days logged yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Plan ────────────────────────────────────────────────────────────────── */

export function PlanView() {
  const { data, error } = useApi<{ markdown?: string; file?: string }>(tmpUrl("campaign/plan"));
  if (error) return <p className="p-3 text-sm text-muted-foreground">{error}</p>;
  if (!data) return <p className="p-3 text-sm text-muted-foreground">Loading plan…</p>;
  if (!data.markdown)
    return <p className="p-3 text-sm text-muted-foreground">No plan document found.</p>;
  return (
    <Card className="max-w-4xl">
      <CardContent className="pt-6">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
          {data.markdown}
        </pre>
        <p className="mt-4 text-xs text-muted-foreground">
          Source: {data.file} in the TMP repo — edit there, this view only renders it.
        </p>
      </CardContent>
    </Card>
  );
}
