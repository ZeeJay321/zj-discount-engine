/**
 * Rule ⇄ Shopify discount sync.
 *
 * Model: the DB row holds the desired state (`config` etc., `configVersion`) and the
 * last state Shopify accepted (`syncedConfig`, `syncedVersion`). Every write to
 * Shopify is ONE mutation that carries the discount fields and the rule-config
 * metafield together, so the discount and its metafield can never disagree.
 *
 *   save → row PENDING → one mutation → SYNCED (syncedConfig = desired)
 *                                      ↘ FAILED (+ syncError; Shopify keeps last good state)
 *
 * Recovery: retry() re-sends the desired state; revert() puts the row back to the
 * last synced state; reconcile() retries stale PENDING/DELETING rows and re-links a
 * discount that was created but whose id never reached the DB (found by ruleId in
 * its metafield), so a create is never duplicated.
 */
import {
  discountClassesFor,
  METAFIELD_KEY,
  METAFIELD_NAMESPACE,
  toMetafieldPayload,
  validateRule,
  type RuleDraft,
  type ValidationError,
} from "@zj/discount-core";
import { checkQuota } from "./discount-quota.server";
import type { RuleRecord, RuleRepo, RuleSnapshot } from "./rule-repo.server";
import { draftToSnapshot, snapshotOf } from "./rule-repo.server";
import {
  createDiscount,
  deleteDiscount,
  errorMessage,
  findDiscountIdByRuleId,
  isNotFound,
  updateDiscount,
  type AdminGraphql,
  type DiscountAutomaticAppInput,
  type MutationResult,
  type UserError,
} from "./shopify-discounts.server";

export const FUNCTION_HANDLE = "zj-discount-function";
/** Rows stuck in PENDING/DELETING longer than this are retried by reconcile(). */
export const STALE_AFTER_MS = 2 * 60 * 1000;

export interface SyncDeps {
  repo: RuleRepo;
  gql: AdminGraphql;
  shop: string;
  now?: () => Date;
}

export type SaveResult =
  | { ok: true; rule: RuleRecord }
  | { ok: false; errors: ValidationError[]; rule?: RuleRecord };

const nowOf = (d: SyncDeps) => (d.now ? d.now() : new Date());

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Dates Shopify should hold. Disabled rules are sent as already ended (Shopify shows
 * them as expired and never runs the Function); the real dates stay in the DB and
 * are sent again on enable. Using the same update mutation for enable/disable keeps
 * it a single atomic call and avoids discountAutomaticActivate overwriting endsAt.
 */
export function shopifyWindow(s: RuleSnapshot, now: Date): { startsAt: string; endsAt: string | null } {
  if (s.enabled) return { startsAt: s.startsAt, endsAt: s.endsAt };
  const endsAt = now.getTime();
  const startsAt = Math.min(Date.parse(s.startsAt), endsAt - 60_000);
  return { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() };
}

export function toDiscountInput(id: string, s: RuleSnapshot, now: Date): DiscountAutomaticAppInput {
  // Shopify does not allow shipping discounts to combine with other shipping discounts.
  const combinesWith =
    s.config.type === "FREE_SHIPPING"
      ? { ...s.combinesWith, shippingDiscounts: false }
      : { ...s.combinesWith };
  return {
    title: s.title,
    functionHandle: FUNCTION_HANDLE,
    discountClasses: discountClassesFor(s),
    combinesWith,
    ...shopifyWindow(s, now),
    metafields: [
      {
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        type: "json",
        value: JSON.stringify(toMetafieldPayload({ id, title: s.title, config: s.config })),
      },
    ],
  };
}

const formatUserErrors = (errs: UserError[]) =>
  errs.map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message)).join("; ");

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Create or edit a rule (validated against the shop's other rules), then push it. */
export async function saveRule(deps: SyncDeps, draft: RuleDraft): Promise<SaveResult> {
  const { repo, shop } = deps;
  const all = await repo.list(shop);
  const existing = draft.id ? all.find((r) => r.id === draft.id) ?? null : null;
  if (draft.id && !existing) return { ok: false, errors: [{ field: "form", message: "Rule not found." }] };

  // A Shopify discount's class (PRODUCT / ORDER / …) can't be changed after creation,
  // and the class follows from the rule type, so the type is fixed once created.
  if (existing && existing.config.type !== draft.config?.type) {
    return {
      ok: false,
      errors: [{ field: "ruleType", message: "A rule's type can't be changed after it's created. Create a new rule instead." }],
    };
  }

  const others = all.filter((r) => r.id !== draft.id && r.syncStatus !== "DELETING");
  const errors = validateRule(draft, others);
  if (errors.length) return { ok: false, errors };

  const snapshot = draftToSnapshot(draft);
  const turningOn = snapshot.enabled && (!existing || !existing.enabled);
  if (turningOn) {
    const quota = await checkQuota(deps.gql);
    if (!quota.ok) return { ok: false, errors: [{ field: "enabled", message: quota.message }] };
  }

  const rule = existing
    ? await repo.update(shop, existing.id, {
        ...snapshot,
        configVersion: existing.configVersion + 1,
        syncStatus: "PENDING",
        syncError: null,
      })
    : await repo.create(shop, snapshot);

  const pushed = await pushToShopify(deps, rule, { mayHaveOrphan: false });
  return { ok: true, rule: pushed };
}

export async function setEnabled(deps: SyncDeps, id: string, enabled: boolean): Promise<SaveResult> {
  const rule = await deps.repo.get(deps.shop, id);
  if (!rule) return { ok: false, errors: [{ field: "form", message: "Rule not found." }] };
  if (rule.enabled === enabled) return { ok: true, rule };
  if (enabled) {
    const others = (await deps.repo.list(deps.shop)).filter((r) => r.id !== id && r.syncStatus !== "DELETING");
    const errors = validateRule({ ...rule, enabled: true }, others);
    if (errors.length) return { ok: false, errors, rule };
    const quota = await checkQuota(deps.gql);
    if (!quota.ok) return { ok: false, errors: [{ field: "enabled", message: quota.message }], rule };
  }
  const updated = await deps.repo.update(deps.shop, id, {
    enabled,
    configVersion: rule.configVersion + 1,
    syncStatus: "PENDING",
    syncError: null,
  });
  return { ok: true, rule: await pushToShopify(deps, updated, { mayHaveOrphan: rule.syncStatus !== "SYNCED" }) };
}

/** Re-send the desired state (after a failure). */
export async function retrySync(deps: SyncDeps, id: string): Promise<RuleRecord | null> {
  const rule = await deps.repo.get(deps.shop, id);
  if (!rule) return null;
  if (rule.syncStatus === "DELETING") {
    await deleteRule(deps, id);
    return deps.repo.get(deps.shop, id);
  }
  return pushToShopify(deps, rule, { mayHaveOrphan: true });
}

/** Throw away unsynced edits: the row goes back to what Shopify already has. */
export async function revertToSynced(deps: SyncDeps, id: string): Promise<SaveResult> {
  const rule = await deps.repo.get(deps.shop, id);
  if (!rule) return { ok: false, errors: [{ field: "form", message: "Rule not found." }] };
  if (!rule.syncedConfig || rule.syncedVersion === null) {
    return { ok: false, errors: [{ field: "form", message: "This rule was never saved to Shopify. Retry or delete it." }], rule };
  }
  const updated = await deps.repo.update(deps.shop, id, {
    ...snapshotOf(rule.syncedConfig),
    configVersion: rule.syncedVersion,
    syncStatus: "SYNCED",
    syncError: null,
  });
  return { ok: true, rule: updated };
}

/** Delete the Shopify discount, then the row. A discount that's already gone counts as deleted. */
export async function deleteRule(deps: SyncDeps, id: string): Promise<{ ok: boolean; error?: string }> {
  const { repo, shop, gql } = deps;
  const rule = await repo.get(shop, id);
  if (!rule) return { ok: true };
  await repo.update(shop, id, { syncStatus: "DELETING", syncError: null });
  try {
    let discountId = rule.shopifyDiscountId;
    if (!discountId && rule.syncStatus !== "SYNCED") discountId = await findDiscountIdByRuleId(gql, id);
    if (discountId) {
      const res = await deleteDiscount(gql, discountId);
      if (!res.ok) {
        const error = formatUserErrors(res.userErrors);
        await repo.update(shop, id, { syncError: error });
        await repo.logEvent({ ruleId: id, shop, action: "delete", ok: false, error });
        return { ok: false, error };
      }
    }
    await repo.logEvent({ ruleId: id, shop, action: "delete", ok: true });
    await repo.remove(shop, id);
    return { ok: true };
  } catch (err) {
    const error = errorMessage(err);
    await repo.update(shop, id, { syncError: error });
    await repo.logEvent({ ruleId: id, shop, action: "delete", ok: false, error });
    return { ok: false, error };
  }
}

/**
 * Retry rows left PENDING/DELETING by a crash or timeout. Bounded per call so the
 * rules list stays fast; run from the list loader.
 */
export async function reconcile(deps: SyncDeps, maxRules = 5): Promise<number> {
  const now = nowOf(deps).getTime();
  const stale = (await deps.repo.list(deps.shop)).filter(
    (r) => (r.syncStatus === "PENDING" || r.syncStatus === "DELETING") && now - Date.parse(r.updatedAt) > STALE_AFTER_MS,
  );
  let handled = 0;
  for (const r of stale.slice(0, maxRules)) {
    if (r.syncStatus === "DELETING") await deleteRule(deps, r.id);
    else await pushToShopify(deps, r, { mayHaveOrphan: true });
    handled++;
  }
  return handled;
}

/**
 * The one place that writes to Shopify for create/update. `mayHaveOrphan`: a previous
 * attempt may have created the discount without the id reaching the DB, so look it
 * up by ruleId before creating another one.
 */
export async function pushToShopify(
  deps: SyncDeps,
  rule: RuleRecord,
  opts: { mayHaveOrphan: boolean },
): Promise<RuleRecord> {
  const { repo, shop, gql } = deps;
  const snapshot = snapshotOf(rule);
  const input = toDiscountInput(rule.id, snapshot, nowOf(deps));
  let action: "create" | "update" | "relink" = rule.shopifyDiscountId ? "update" : "create";
  try {
    let discountId = rule.shopifyDiscountId;
    if (!discountId && opts.mayHaveOrphan) {
      discountId = await findDiscountIdByRuleId(gql, rule.id);
      if (discountId) action = "relink";
    }
    let res: MutationResult = discountId ? await updateDiscount(gql, discountId, input) : await createDiscount(gql, input);
    // The discount was deleted in Shopify admin: recreate it rather than failing forever.
    if (!res.ok && discountId && res.userErrors.length > 0 && res.userErrors.every(isNotFound)) {
      discountId = null;
      action = "create";
      res = await createDiscount(gql, input);
    }
    if (!res.ok) {
      const error = formatUserErrors(res.userErrors);
      await repo.logEvent({ ruleId: rule.id, shop, action, ok: false, error });
      return repo.update(shop, rule.id, { syncStatus: "FAILED", syncError: error, shopifyDiscountId: discountId ?? null });
    }
    await repo.logEvent({ ruleId: rule.id, shop, action, ok: true });
    return repo.update(shop, rule.id, {
      shopifyDiscountId: res.discountId,
      syncStatus: "SYNCED",
      syncedVersion: rule.configVersion,
      syncedConfig: snapshot,
      syncError: null,
      syncedAt: nowOf(deps).toISOString(),
    });
  } catch (err) {
    const error = errorMessage(err);
    await repo.logEvent({ ruleId: rule.id, shop, action, ok: false, error });
    return repo.update(shop, rule.id, { syncStatus: "FAILED", syncError: error });
  }
}
