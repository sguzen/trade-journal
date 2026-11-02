import { applyPreset, campaignData, setBalances } from "@/server/campaign";
import { bad, handler, ok, requireValue } from "@/server/api";

export const GET = handler(() => ok(campaignData()));

/**
 * Two actions, both small: attach a preset's rules to an account, or correct
 * the balances the floor is computed from.
 */
export const POST = handler(async (request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid campaign request.");
  }
  requireValue(
    body && typeof body === "object" && !Array.isArray(body),
    "Provide a campaign action.",
  );
  const input = body as Record<string, unknown>;
  const accountId = typeof input.accountId === "string" ? input.accountId : "";
  requireValue(accountId, "Choose an account.");

  if (input.action === "preset") {
    const presetKey = typeof input.presetKey === "string" ? input.presetKey : "";
    requireValue(presetKey, "Choose a preset.");
    applyPreset(accountId, presetKey);
    return ok(campaignData());
  }

  if (input.action === "balances") {
    const amount = (key: string) => {
      const value = input[key];
      if (value === undefined || value === null || value === "") return undefined;
      requireValue(typeof value === "number" && Number.isFinite(value), `Enter a valid ${key}.`);
      return value as number;
    };
    setBalances(accountId, {
      current: amount("current"),
      peak: amount("peak"),
      starting: amount("starting"),
    });
    return ok(campaignData());
  }

  return bad("Unknown campaign action.");
});
