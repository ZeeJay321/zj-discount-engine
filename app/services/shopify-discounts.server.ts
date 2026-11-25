/**
 * Admin GraphQL operations for the rule ⇄ discount sync. Each function does exactly
 * one GraphQL request. Field names were checked against the 2026-10 Admin schema.
 */

/** Runs one GraphQL request and returns `data`; throws on transport or top-level GraphQL errors. */
export type AdminGraphql = <T = unknown>(query: string, variables?: Record<string, unknown>) => Promise<T>;

interface AdminLike {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export class ShopifyApiError extends Error {}

export function adminGraphql(admin: AdminLike): AdminGraphql {
  return async <T,>(query: string, variables?: Record<string, unknown>) => {
    let json: { data?: T; errors?: unknown };
    try {
      const res = await admin.graphql(query, { variables });
      json = (await res.json()) as typeof json;
    } catch (err) {
      throw new ShopifyApiError(errorMessage(err));
    }
    if (json.errors) throw new ShopifyApiError(`GraphQL error: ${JSON.stringify(json.errors).slice(0, 500)}`);
    if (!json.data) throw new ShopifyApiError("Empty GraphQL response");
    return json.data;
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}

export interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

export interface DiscountAutomaticAppInput {
  title: string;
  functionHandle: string;
  discountClasses: string[];
  combinesWith: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
  startsAt: string;
  endsAt: string | null;
  metafields: Array<{ namespace: string; key: string; type: "json"; value: string }>;
}

export type MutationResult = { ok: true; discountId: string } | { ok: false; userErrors: UserError[] };

const CREATE = `#graphql
  mutation ZjCreateRuleDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount { discountId }
      userErrors { field message code }
    }
  }`;

const UPDATE = `#graphql
  mutation ZjUpdateRuleDiscount($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount { discountId }
      userErrors { field message code }
    }
  }`;

const DELETE = `#graphql
  mutation ZjDeleteRuleDiscount($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors { field message code }
    }
  }`;

const APP_DISCOUNTS = `#graphql
  query ZjAppDiscounts($after: String) {
    discountNodes(first: 50, after: $after, query: "method:automatic type:app") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        metafield(namespace: "$app", key: "rule-config") { jsonValue }
      }
    }
  }`;

// type:all_with_app — without it app (Function) discounts are left out of the count.
// status takes a comma list; `limit: null` so the count is never capped.
const ACTIVE_COUNT = `#graphql
  query ZjActiveAutomaticDiscounts {
    discountNodesCount(query: "method:automatic status:active,scheduled type:all_with_app", limit: null) { count }
  }`;

const SHOP_INFO = `#graphql
  query ZjShopInfo {
    shop {
      currencyCode
      ianaTimezone
      plan { partnerDevelopment shopifyPlus publicDisplayName }
    }
  }`;

const COLLECTION_TITLES = `#graphql
  query ZjCollectionTitles($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Collection { id title } }
  }`;

type MutationPayload = { automaticAppDiscount: { discountId: string } | null; userErrors: UserError[] };

function toResult(payload: MutationPayload | null | undefined): MutationResult {
  if (!payload) return { ok: false, userErrors: [{ message: "No response from Shopify" }] };
  if (payload.userErrors.length > 0 || !payload.automaticAppDiscount) {
    return { ok: false, userErrors: payload.userErrors.length ? payload.userErrors : [{ message: "Discount not returned" }] };
  }
  return { ok: true, discountId: payload.automaticAppDiscount.discountId };
}

export async function createDiscount(gql: AdminGraphql, input: DiscountAutomaticAppInput): Promise<MutationResult> {
  const data = await gql<{ discountAutomaticAppCreate: MutationPayload }>(CREATE, { automaticAppDiscount: input });
  return toResult(data.discountAutomaticAppCreate);
}

export async function updateDiscount(gql: AdminGraphql, id: string, input: DiscountAutomaticAppInput): Promise<MutationResult> {
  const data = await gql<{ discountAutomaticAppUpdate: MutationPayload }>(UPDATE, { id, automaticAppDiscount: input });
  return toResult(data.discountAutomaticAppUpdate);
}

/** Deleting a discount that no longer exists counts as success. */
export async function deleteDiscount(gql: AdminGraphql, id: string): Promise<{ ok: true } | { ok: false; userErrors: UserError[] }> {
  const data = await gql<{ discountAutomaticDelete: { deletedAutomaticDiscountId: string | null; userErrors: UserError[] } }>(
    DELETE,
    { id },
  );
  const errs = data.discountAutomaticDelete.userErrors;
  if (errs.length === 0 || errs.every(isNotFound)) return { ok: true };
  return { ok: false, userErrors: errs };
}

export function isNotFound(e: UserError): boolean {
  const m = e.message.toLowerCase();
  return e.code === "NOT_FOUND" || m.includes("does not exist") || m.includes("not found") || m.includes("couldn't find");
}

/** Finds this app's automatic discount carrying `ruleId` in its rule-config metafield (orphan re-link). */
export async function findDiscountIdByRuleId(gql: AdminGraphql, ruleId: string, maxPages = 10): Promise<string | null> {
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: {
      discountNodes: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string; metafield: { jsonValue: unknown } | null }>;
      };
    } = await gql(APP_DISCOUNTS, { after });
    for (const n of data.discountNodes.nodes) {
      const v = n.metafield?.jsonValue as { ruleId?: unknown } | undefined;
      if (v && v.ruleId === ruleId) return n.id;
    }
    if (!data.discountNodes.pageInfo.hasNextPage) return null;
    after = data.discountNodes.pageInfo.endCursor;
  }
  return null;
}

/** Active + scheduled automatic discounts across the whole store (all apps and native). */
export async function countActiveAutomaticDiscounts(gql: AdminGraphql): Promise<number> {
  const data = await gql<{ discountNodesCount: { count: number } }>(ACTIVE_COUNT);
  return data.discountNodesCount.count;
}

export interface ShopInfo {
  currencyCode: string;
  ianaTimezone: string;
  plan: { partnerDevelopment: boolean; shopifyPlus: boolean; publicDisplayName: string };
}

export async function getShopInfo(gql: AdminGraphql): Promise<ShopInfo> {
  const data = await gql<{ shop: ShopInfo }>(SHOP_INFO);
  return data.shop;
}

export async function getCollectionTitles(gql: AdminGraphql, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const data = await gql<{ nodes: Array<{ id?: string; title?: string } | null> }>(COLLECTION_TITLES, { ids });
  const out: Record<string, string> = {};
  for (const n of data.nodes) if (n?.id && n.title) out[n.id] = n.title;
  return out;
}
