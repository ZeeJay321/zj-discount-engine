import type { RuleConfig } from "@zj/discount-core";
import type { RulePatch, RuleRecord, RuleRepo, RuleSnapshot, SyncEventInput } from "../rule-repo.server";
import type { AdminGraphql } from "../shopify-discounts.server";

export const SHOP = "zj-test.myshopify.com";
export const C1 = "gid://shopify/Collection/1";

export function memoryRepo(clock: () => Date = () => new Date()) {
  const rows = new Map<string, RuleRecord>();
  const events: SyncEventInput[] = [];
  let seq = 0;
  const repo: RuleRepo = {
    async list(shop) {
      return [...rows.values()].filter((r) => r.shop === shop).map((r) => structuredClone(r));
    },
    async get(shop, id) {
      const r = rows.get(id);
      return r && r.shop === shop ? structuredClone(r) : null;
    },
    async create(shop, s: RuleSnapshot) {
      const now = clock().toISOString();
      const r: RuleRecord = {
        ...structuredClone(s),
        id: `rule_${++seq}`,
        shop,
        configVersion: 1,
        shopifyDiscountId: null,
        syncStatus: "PENDING",
        syncedVersion: null,
        syncedConfig: null,
        syncError: null,
        syncedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(r.id, r);
      return structuredClone(r);
    },
    async update(shop, id, patch: RulePatch) {
      const r = rows.get(id);
      if (!r || r.shop !== shop) throw new Error("Rule not found");
      const next = { ...r, ...structuredClone(patch), updatedAt: clock().toISOString() } as RuleRecord;
      rows.set(id, next);
      return structuredClone(next);
    },
    async remove(shop, id) {
      if (rows.get(id)?.shop === shop) rows.delete(id);
    },
    async logEvent(e) {
      events.push(e);
    },
    async deleteShopData(shop) {
      for (const [id, r] of rows) if (r.shop === shop) rows.delete(id);
    },
  };
  return { repo, rows, events };
}

type Handler = (variables: Record<string, unknown> | undefined) => unknown;

/**
 * Scripted Admin GraphQL: handlers keyed by operation name (e.g. "ZjCreateRuleDiscount").
 * A handler may throw to simulate a network/GraphQL failure. Calls are recorded.
 */
export function fakeGql(handlers: Record<string, Handler>) {
  const calls: Array<{ op: string; variables?: Record<string, unknown> }> = [];
  const gql: AdminGraphql = async <T,>(query: string, variables?: Record<string, unknown>) => {
    const op = /(?:mutation|query)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
    calls.push({ op, variables });
    const h = handlers[op];
    if (!h) throw new Error(`Unexpected GraphQL operation ${op}`);
    return h(variables) as T;
  };
  return { gql, calls, ops: () => calls.map((c) => c.op) };
}

export const created = (id = "gid://shopify/DiscountAutomaticNode/1") => () => ({
  discountAutomaticAppCreate: { automaticAppDiscount: { discountId: id }, userErrors: [] },
});
export const updated = (id = "gid://shopify/DiscountAutomaticNode/1") => () => ({
  discountAutomaticAppUpdate: { automaticAppDiscount: { discountId: id }, userErrors: [] },
});
export const userError = (op: "discountAutomaticAppCreate" | "discountAutomaticAppUpdate", message: string) => () => ({
  [op]: { automaticAppDiscount: null, userErrors: [{ field: ["automaticAppDiscount", "title"], message, code: "INVALID" }] },
});
export const count = (n: number) => () => ({ discountNodesCount: { count: n } });
export const appDiscounts = (nodes: Array<{ id: string; ruleId?: string }>) => () => ({
  discountNodes: {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: nodes.map((n) => ({ id: n.id, metafield: n.ruleId ? { jsonValue: { ruleId: n.ruleId } } : null })),
  },
});

export const pct10: RuleConfig = {
  type: "AMOUNT_OFF_PRODUCTS",
  target: { kind: "COLLECTIONS", collectionIds: [C1] },
  value: { kind: "PERCENTAGE", percent: 10 },
};
