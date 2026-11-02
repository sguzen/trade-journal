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

import { AlertTriangle, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
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
};

/** The tracker stores minor units; this layer already speaks whole currency. */
const money = (value: number, currency: string) => propMoney(Math.round(value * 100), currency);

export function CampaignRules() {
  const { data } = useApi<{ accounts: CampaignAccount[] }>("/api/campaign");
  const accounts = data?.accounts ?? [];
  if (accounts.length === 0) return null;

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
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    <MonetaryValue>{money(a.floor, a.currency)}</MonetaryValue>
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

        <p className="text-xs text-muted-foreground">
          Day one is the profit the first qualifying day must carry so the rest only need to clear
          the daily floor. A floor above the starting balance is not an error: trailing plans that
          lock there kill an account that is still showing profit.
        </p>
      </CardContent>
    </Card>
  );
}
