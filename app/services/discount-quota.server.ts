/**
 * Shopify allows at most 25 active automatic discounts per store, counting every
 * app's and the merchant's own. A 26th is silently not applied at checkout, so the
 * app refuses to create or enable a rule that would go over.
 * The count includes scheduled discounts too (conservative: it may block slightly
 * early, never late).
 */
import { isActiveAt } from "@zj/discount-core";
import type { RuleRecord } from "./rule-repo.server";
import { countActiveAutomaticDiscounts, errorMessage, type AdminGraphql } from "./shopify-discounts.server";

export const AUTOMATIC_DISCOUNT_LIMIT = 25;

export type QuotaCheck = { ok: true; used: number } | { ok: false; used: number | null; message: string };

export async function checkQuota(gql: AdminGraphql): Promise<QuotaCheck> {
  let used: number;
  try {
    used = await countActiveAutomaticDiscounts(gql);
  } catch (err) {
    return { ok: false, used: null, message: `Couldn't check the automatic discount limit: ${errorMessage(err)}. Try again.` };
  }
  if (used >= AUTOMATIC_DISCOUNT_LIMIT) {
    return {
      ok: false,
      used,
      message: `This store already has ${used} of ${AUTOMATIC_DISCOUNT_LIMIT} active or scheduled automatic discounts (all apps included). Disable or delete one first.`,
    };
  }
  return { ok: true, used };
}

export interface QuotaSummary {
  used: number | null;
  limit: number;
  /** Enabled rules of this app that are synced and active or scheduled. */
  fromApp: number;
}

export async function quotaSummary(gql: AdminGraphql, rules: RuleRecord[], now: Date): Promise<QuotaSummary> {
  let used: number | null = null;
  try {
    used = await countActiveAutomaticDiscounts(gql);
  } catch {
    used = null;
  }
  const fromApp = rules.filter(
    (r) =>
      r.syncStatus === "SYNCED" &&
      r.enabled &&
      (isActiveAt(r, now) || Date.parse(r.startsAt) > now.getTime()),
  ).length;
  return { used, limit: AUTOMATIC_DISCOUNT_LIMIT, fromApp };
}
