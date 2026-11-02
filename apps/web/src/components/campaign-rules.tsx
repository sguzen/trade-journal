"use client";

/**
 * Campaign rules over the prop accounts the tracker already keeps.
 *
 * The tracker records what an account cost and what it paid. This says whether
 * it is still alive: where its floor sits, what is left to lose before that
 * floor, and what the plan still demands before it pays anything.
 *
 * It renders only for accounts that have rules recorded, so the page is
 * unchanged for anyone who has not filled them in.
 */

import { useState } from "react";

import { AlertTriangle, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { OptionSelect } from "./ui/option-select";
import { MonetaryValue } from "./privacy";
import { useApi } from "@/lib/use-api";
import { propMoney } from "@/lib/prop-firms";

type CampaignAccount = {
  accountId: string;
  firm: string;
  name: string;
  currency: string;
  stage: "eval" | "funded";
  status: string;
  floor: number;
  riskBudget: number;
  currentBalance: number;
  dayOneTarget: number;
  evalMinDays: number;
  isFlex: boolean;
  breached: boolean;
  unrecordedBreach: boolean;
  balanceSource: "journal" | "manual";
  tradeCount: number;
  peakIsLowerBound: boolean;
  mfeCovered: number;
};

type Preset = { key: string; label: string; source: string; caveats: string[] };
type Unconfigured = { accountId: string; firm: string; name: string; accountSize: number };
type CampaignPayload = {
  accounts: CampaignAccount[];
  unconfigured: Unconfigured[];
  presets: Preset[];
};

/** The tracker stores minor units; this layer already speaks whole currency. */
const money = (value: number, currency: string) => propMoney(Math.round(value * 100), currency);

export function CampaignRules() {
  const { data, refresh } = useApi<CampaignPayload>("/api/campaign");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const accounts = data?.accounts ?? [];
  const unconfigured = data?.unconfigured ?? [];
  const presets = data?.presets ?? [];
  if (accounts.length === 0 && unconfigured.length === 0) return null;

  const apply = async (accountId: string, presetKey: string) => {
    if (!presetKey) return;
    setBusy(accountId);
    setError("");
    try {
      const response = await fetch("/api/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preset", accountId, presetKey }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Could not apply that preset.");
      }
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply that preset.");
    } finally {
      setBusy("");
    }
  };

  const dead = accounts.filter((a) => a.unrecordedBreach);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" aria-hidden />
          Campaign rules
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {dead.length > 0 && (
          <p
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
            role="status"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {dead.length === 1
                ? "One account is past its drawdown floor but still marked active."
                : `${dead.length} accounts are past their drawdown floor but still marked active.`}{" "}
              The rules say they are gone; the tracker has not been told.
            </span>
          </p>
        )}

        {accounts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-4 font-medium">Account</th>
                  <th className="py-1 pr-4 font-medium">Stage</th>
                  <th className="py-1 pr-4 text-right font-medium">Balance</th>
                  <th className="py-1 pr-4 text-right font-medium">Floor</th>
                  <th className="py-1 pr-4 text-right font-medium">Left to lose</th>
                  <th className="py-1 pr-4 text-right font-medium">Day one</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.accountId} className="border-t">
                    <td className="py-1.5 pr-4">
                      <span className="font-medium">{a.firm}</span>{" "}
                      <span className="text-muted-foreground">{a.name}</span>
                      {a.unrecordedBreach && (
                        <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">
                          breached
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-4 text-muted-foreground">
                      {a.stage}
                      {a.isFlex && a.stage === "funded" ? " · flex" : ""}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      <MonetaryValue>{money(a.currentBalance, a.currency)}</MonetaryValue>
                      <span
                        className="ml-1 text-xs text-muted-foreground"
                        title={
                          a.balanceSource === "journal"
                            ? `Derived from ${a.tradeCount} closed trades in the linked journal.`
                            : "Typed in. No journal account is linked, so this does not move on its own."
                        }
                      >
                        {a.balanceSource === "journal" ? `${a.tradeCount}t` : "typed"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      <MonetaryValue>{money(a.floor, a.currency)}</MonetaryValue>
                      {a.peakIsLowerBound && (
                        <span
                          className="ml-1 text-xs text-muted-foreground"
                          title={`This plan trails equity reached inside a trade. ${a.tradeCount - a.mfeCovered} of ${a.tradeCount} trades have no MFE estimate, so the real floor is at least this high. Fetch market data on those trades to make it exact.`}
                        >
                          ≥
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-1.5 pr-4 text-right tabular-nums ${
                        a.riskBudget === 0 ? "text-destructive" : ""
                      }`}
                    >
                      <MonetaryValue>{money(a.riskBudget, a.currency)}</MonetaryValue>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
                      <MonetaryValue>{money(a.dayOneTarget, a.currency)}</MonetaryValue>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {unconfigured.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              No rules recorded yet for{" "}
              {unconfigured.length === 1 ? "one account" : `${unconfigured.length} accounts`}. Pick
              the plan it was bought under — the terms are copied onto the account, so editing a
              preset later never rewrites them.
            </p>
            {unconfigured.map((a) => (
              <div key={a.accountId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-48">
                  <span className="font-medium">{a.firm}</span>{" "}
                  <span className="text-muted-foreground">{a.name}</span>
                </span>
                <OptionSelect
                  className="w-64"
                  value=""
                  disabled={busy === a.accountId}
                  onValueChange={(key) => apply(a.accountId, key)}
                  aria-label={`Plan for ${a.firm} ${a.name}`}
                >
                  <option value="">Choose a plan…</option>
                  {presets.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                      {p.caveats.length > 0 ? " ⚠" : ""}
                    </option>
                  ))}
                </OptionSelect>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              ⚠ marks a plan with terms that were inferred rather than read from the firm. Check
              those before trusting the floor.
            </p>
          </div>
        )}

        {accounts.some((a) => a.peakIsLowerBound) && (
          <p className="text-xs text-muted-foreground">
            ≥ marks a floor whose peak is bounded from below. Those plans trail equity reached
            inside a trade, so each trade needs an MFE estimate; trades without one contribute only
            their closing balance. Fetch market data on a trade to fill its estimate in, and the
            floor becomes exact. Until then the room left is at most what is shown.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Day one is the profit the first qualifying day must carry so the rest only need to clear
          the daily floor. A floor above the starting balance is not an error: trailing plans that
          lock there kill an account that is still showing profit.
        </p>
      </CardContent>
    </Card>
  );
}
