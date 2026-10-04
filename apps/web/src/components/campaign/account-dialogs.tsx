"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { postJson } from "@/lib/use-api";
import { type RuleSet, tmpUrl } from "@/lib/campaign";

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
    {label}
    {children}
  </label>
);

const PresetSelect = ({ presets }: { presets: Record<string, RuleSet> }) => (
  <select
    name="preset"
    className="h-9 rounded border bg-background px-2 text-sm text-foreground"
  >
    {Object.keys(presets).map((name) => (
      <option key={name}>{name}</option>
    ))}
  </select>
);

/** "+ New account" — mirrors TMP's add dialog field for field. */
export function NewAccountDialog({
  presets,
  onSaved,
}: {
  presets: Record<string, RuleSet>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postJson(tmpUrl("accounts"), {
        account_id: fd.get("account_id"),
        preset: fd.get("preset"),
        purchase_cost: Number(fd.get("purchase_cost")),
        purchase_date: fd.get("purchase_date") || null,
        stage: fd.get("stage"),
        alias: fd.get("alias") || "",
        notes: fd.get("notes") ?? "",
      });
      setOpen(false);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + New account
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New account</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Account ID">
              <Input name="account_id" required placeholder="Lucid_4" autoFocus />
            </Field>
            <Field label="Plan">
              <PresetSelect presets={presets} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cost $">
                <Input name="purchase_cost" type="number" step="0.01" required />
              </Field>
              <Field label="Date">
                <Input name="purchase_date" type="date" />
              </Field>
            </div>
            <Field label="Starts as">
              <div className="flex gap-4 text-sm text-foreground">
                <label className="flex items-center gap-1">
                  <input type="radio" name="stage" value="eval" defaultChecked /> Evaluation
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name="stage" value="funded" /> Funded (instant)
                </label>
              </div>
            </Field>
            <Field label="Alias">
              <Input name="alias" placeholder="funded name, if already known (optional)" />
            </Field>
            <Field label="Notes">
              <Input name="notes" />
            </Field>
            {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add account"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * "+ Bulk failed" — backfills already-blown accounts as breached so spend,
 * net and pass rate stay honest rather than flattering.
 */
export function BulkFailedDialog({
  presets,
  onSaved,
}: {
  presets: Record<string, RuleSet>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postJson(tmpUrl("accounts/bulk-failed"), {
        preset: fd.get("preset"),
        count: Number(fd.get("count")),
        purchase_cost: Number(fd.get("purchase_cost")),
        purchase_date: fd.get("purchase_date") || null,
        died_in: fd.get("died_in"),
        id_prefix: fd.get("id_prefix") || null,
        note: fd.get("note") ?? "",
      });
      setOpen(false);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record them");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        title="backfill blown accounts that were never recorded"
      >
        + Bulk failed
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Backfill failed accounts</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Records already-blown accounts as breached so spend, net and pass rate stay honest.
              They land straight in Closed accounts.
            </p>
            <Field label="Plan">
              <PresetSelect presets={presets} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="How many">
                <Input name="count" type="number" min="1" max="50" defaultValue="1" required />
              </Field>
              <Field label="Cost each $">
                <Input name="purchase_cost" type="number" step="0.01" required />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Purchase date">
                <Input name="purchase_date" type="date" />
              </Field>
              <Field label="ID prefix">
                <Input name="id_prefix" placeholder="auto: Firm-lost" />
              </Field>
            </div>
            <Field label="Died in">
              <div className="flex gap-4 text-sm text-foreground">
                <label className="flex items-center gap-1">
                  <input type="radio" name="died_in" value="eval" defaultChecked /> Evaluation
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name="died_in" value="funded" /> Funded
                </label>
              </div>
            </Field>
            <Field label="Note">
              <Input name="note" placeholder="previous batch, unrecorded" />
            </Field>
            {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Recording…" : "Record them"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Monthly eval budget. The cap is deliberately fixed and never moves with
 * P&L — the month after a big payout is when it earns its keep.
 */
export function BudgetEditor({
  current,
  onSaved,
}: {
  current: number;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postJson(tmpUrl("campaign/config"), {
        monthly_eval_budget: Number(fd.get("monthly_eval_budget")),
      });
      setOpen(false);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the budget");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="absolute inset-0 cursor-pointer"
        aria-label="Set the monthly eval budget"
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Monthly eval budget</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This month&apos;s eval spend, fees included, against a fixed cap. The cap never
              moves with P&amp;L. 0 disables it.
            </p>
            <Field label="Monthly eval budget $">
              <Input
                name="monthly_eval_budget"
                type="number"
                step="1"
                defaultValue={current || 500}
                required
                autoFocus
              />
            </Field>
            {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
