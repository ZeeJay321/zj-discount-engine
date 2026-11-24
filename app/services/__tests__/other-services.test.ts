import { describe, expect, it } from "vitest";
import { handleComplianceWebhook } from "../compliance.server";
import { AUTOMATIC_DISCOUNT_LIMIT, checkQuota, quotaSummary } from "../discount-quota.server";
import { adminGraphql, deleteDiscount, findDiscountIdByRuleId, getCollectionTitles, isNotFound, ShopifyApiError } from "../shopify-discounts.server";
import { checkStore, evaluateStore } from "../store-check.server";
import { count, fakeGql, memoryRepo, pct10, SHOP } from "./fakes";

describe("quota", () => {
  it("limit is Shopify's 25", () => expect(AUTOMATIC_DISCOUNT_LIMIT).toBe(25));
  it("allows below 25 and blocks at 25", async () => {
    expect(await checkQuota(fakeGql({ ZjActiveAutomaticDiscounts: count(24) }).gql)).toEqual({ ok: true, used: 24 });
    const blocked = await checkQuota(fakeGql({ ZjActiveAutomaticDiscounts: count(25) }).gql);
    expect(blocked.ok).toBe(false);
  });
  it("summary counts this app's synced, enabled, active-or-scheduled rules", async () => {
    const { repo } = memoryRepo();
    const base = { title: "t", priority: 0, endsAt: null, combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }, config: pct10 };
    const a = await repo.create(SHOP, { ...base, enabled: true, startsAt: "2026-01-01T00:00:00Z" });
    const b = await repo.create(SHOP, { ...base, enabled: true, startsAt: "2030-01-01T00:00:00Z" });
    await repo.create(SHOP, { ...base, enabled: false, startsAt: "2026-01-01T00:00:00Z" });
    await repo.update(SHOP, a.id, { syncStatus: "SYNCED" });
    await repo.update(SHOP, b.id, { syncStatus: "SYNCED" });
    const rules = await repo.list(SHOP);
    const s = await quotaSummary(fakeGql({ ZjActiveAutomaticDiscounts: count(7) }).gql, rules, new Date("2026-12-01T00:00:00Z"));
    expect(s).toEqual({ used: 7, limit: 25, fromApp: 2 });
    const unknown = await quotaSummary(fakeGql({ ZjActiveAutomaticDiscounts: () => { throw new Error("x"); } }).gql, rules, new Date());
    expect(unknown.used).toBeNull();
  });
});

describe("store check", () => {
  const info = (dev: boolean, plus: boolean) => ({
    currencyCode: "USD",
    ianaTimezone: "America/New_York",
    plan: { partnerDevelopment: dev, shopifyPlus: plus, publicDisplayName: dev ? "Development" : plus ? "Plus" : "Basic" },
  });
  it("ok on development and Plus stores, not on others", () => {
    expect(evaluateStore(info(true, false))).toMatchObject({ ok: true, isDevelopment: true });
    expect(evaluateStore(info(false, true))).toMatchObject({ ok: true, isPlus: true });
    expect(evaluateStore(info(false, false))).toMatchObject({ ok: false, planName: "Basic" });
  });
  it("reports failure to check as not ok", async () => {
    const res = await checkStore(fakeGql({ ZjShopInfo: () => { throw new Error("denied"); } }).gql);
    expect(res).toMatchObject({ ok: false, error: "denied" });
    const good = await checkStore(fakeGql({ ZjShopInfo: () => ({ shop: info(true, false) }) }).gql);
    expect(good).toMatchObject({ ok: true, timezone: "America/New_York", currencyCode: "USD" });
  });
});

describe("compliance webhooks", () => {
  it("shop/redact deletes the shop's rules and sessions", async () => {
    const { repo, rows } = memoryRepo();
    await repo.create(SHOP, { title: "t", enabled: true, priority: 0, startsAt: "2026-01-01T00:00:00Z", endsAt: null, combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }, config: pct10 });
    await repo.create("other.myshopify.com", { title: "t", enabled: true, priority: 0, startsAt: "2026-01-01T00:00:00Z", endsAt: null, combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }, config: pct10 });
    const sessions: string[] = [];
    expect(await handleComplianceWebhook("SHOP_REDACT", SHOP, { rules: repo, deleteSessions: async (s) => { sessions.push(s); } })).toBe("redacted");
    expect([...rows.values()].map((r) => r.shop)).toEqual(["other.myshopify.com"]);
    expect(sessions).toEqual([SHOP]);
  });
  it.each(["CUSTOMERS_DATA_REQUEST", "customers/redact"])("%s: nothing stored, nothing to do", async (topic) => {
    const deps = { rules: { deleteShopData: async () => { throw new Error("must not be called"); } }, deleteSessions: async () => { throw new Error("must not be called"); } };
    expect(await handleComplianceWebhook(topic, SHOP, deps)).toBe("no-data");
  });
});

describe("shopify-discounts helpers", () => {
  const admin = (body: unknown, fail = false) => ({
    graphql: async () => {
      if (fail) throw new Error("ECONNRESET");
      return new Response(JSON.stringify(body));
    },
  });
  it("adminGraphql returns data and turns errors into ShopifyApiError", async () => {
    expect(await adminGraphql(admin({ data: { a: 1 } }))("query X { a }")).toEqual({ a: 1 });
    await expect(adminGraphql(admin({ errors: [{ message: "bad" }] }))("query X { a }")).rejects.toBeInstanceOf(ShopifyApiError);
    await expect(adminGraphql(admin({}))("query X { a }")).rejects.toThrow(/Empty/);
    await expect(adminGraphql(admin({}, true))("query X { a }")).rejects.toThrow(/ECONNRESET/);
  });
  it("isNotFound recognises Shopify's not-found errors", () => {
    expect(isNotFound({ message: "Discount does not exist" })).toBe(true);
    expect(isNotFound({ message: "x", code: "NOT_FOUND" })).toBe(true);
    expect(isNotFound({ message: "Internal error" })).toBe(false);
  });
  it("deleteDiscount: real errors are returned", async () => {
    const gql = fakeGql({ ZjDeleteRuleDiscount: () => ({ discountAutomaticDelete: { deletedAutomaticDiscountId: null, userErrors: [{ message: "Internal" }] } }) }).gql;
    expect((await deleteDiscount(gql, "x")).ok).toBe(false);
  });
  it("findDiscountIdByRuleId pages through app discounts", async () => {
    let page = 0;
    const gql = fakeGql({
      ZjAppDiscounts: () => {
        page++;
        return page === 1
          ? { discountNodes: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ id: "a", metafield: null }, { id: "b", metafield: { jsonValue: { ruleId: "other" } } }] } }
          : { discountNodes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "c", metafield: { jsonValue: { ruleId: "r1" } } }] } };
      },
    }).gql;
    expect(await findDiscountIdByRuleId(gql, "r1")).toBe("c");
    page = 0;
    expect(await findDiscountIdByRuleId(gql, "zzz")).toBeNull();
    page = 0;
    expect(await findDiscountIdByRuleId(gql, "zzz", 1)).toBeNull();
  });
  it("getCollectionTitles maps ids to titles", async () => {
    const f = fakeGql({ ZjCollectionTitles: () => ({ nodes: [{ id: "g1", title: "Winter" }, null, {}] }) });
    expect(await getCollectionTitles(f.gql, ["g1", "g2"])).toEqual({ g1: "Winter" });
    expect(await getCollectionTitles(f.gql, [])).toEqual({});
    expect(f.calls).toHaveLength(1);
  });
});
