import { describe, expect, it } from "vitest";
import type { BuyXGetYConfig } from "@zj/discount-core";
import { PUBLIC_OFFERS_KEY, publicOffers, publishOffers } from "../public-offers.server";
import type { RuleRecord } from "../rule-repo.server";
import { fakeGql, pct10, SHOP } from "./fakes";

const bxgy: BuyXGetYConfig = {
  type: "BUY_X_GET_Y",
  target: { kind: "PRODUCTS", productIds: ["gid://shopify/Product/1"] },
  buyQuantity: 2,
  getQuantity: 1,
  percent: 100,
  limitPerOrder: 2,
};

function rule(o: Partial<RuleRecord> = {}): RuleRecord {
  const snapshot = {
    title: "Buy 2 get 1 free",
    enabled: true,
    priority: 1,
    startsAt: "2026-11-25T05:00:00.000Z",
    endsAt: "2026-12-01T04:59:59.000Z",
    combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
    config: bxgy,
  };
  return {
    ...snapshot,
    id: "rule_1",
    shop: SHOP,
    configVersion: 1,
    shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/1",
    syncStatus: "SYNCED",
    syncedVersion: 1,
    syncedConfig: snapshot,
    syncError: null,
    syncedAt: null,
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
    ...o,
  };
}

describe("publicOffers", () => {
  it("publishes live Buy X Get Y rules only", () => {
    const offers = publicOffers([
      rule(),
      rule({ id: "r2", config: pct10, syncedConfig: { ...rule().syncedConfig!, config: pct10 } }),
    ]).offers;
    expect(offers).toEqual([
      {
        type: "BUY_X_GET_Y",
        title: "Buy 2 get 1 free",
        startsAt: "2026-11-25T05:00:00.000Z",
        endsAt: "2026-12-01T04:59:59.000Z",
        buyQuantity: 2,
        getQuantity: 1,
        percent: 100,
        limitPerOrder: 2,
        target: bxgy.target,
      },
    ]);
  });

  it("uses what Shopify has, not unsynced edits", () => {
    const pendingEdit = rule({ syncStatus: "PENDING", config: { ...bxgy, buyQuantity: 5 } });
    expect(publicOffers([pendingEdit]).offers[0].buyQuantity).toBe(2);
  });

  it("leaves out disabled, never-synced and deleting rules", () => {
    const disabled = rule({ syncedConfig: { ...rule().syncedConfig!, enabled: false } });
    const neverSynced = rule({ shopifyDiscountId: null, syncedConfig: null, syncStatus: "FAILED" });
    const deleting = rule({ syncStatus: "DELETING" });
    expect(publicOffers([disabled, neverSynced, deleting]).offers).toEqual([]);
  });
});

describe("publishOffers", () => {
  const shop = (value: string | null) => () => ({
    shop: { id: "gid://shopify/Shop/1", metafield: value === null ? null : { value } },
  });

  it("writes the shop metafield when it changed", async () => {
    const fake = fakeGql({ ZjPublicOffers: shop(null), ZjSetPublicOffers: () => ({ metafieldsSet: { userErrors: [] } }) });
    expect(await publishOffers(fake.gql, [rule()])).toBe("written");
    const write = fake.calls.find((c) => c.op === "ZjSetPublicOffers")!;
    const [mf] = (write.variables as { metafields: Record<string, string>[] }).metafields;
    expect(mf).toMatchObject({ ownerId: "gid://shopify/Shop/1", namespace: "$app", key: PUBLIC_OFFERS_KEY, type: "json" });
    expect(JSON.parse(mf.value).offers).toHaveLength(1);
  });

  it("skips the write when nothing changed", async () => {
    const value = JSON.stringify(publicOffers([rule()]));
    const fake = fakeGql({ ZjPublicOffers: shop(value) });
    expect(await publishOffers(fake.gql, [rule()])).toBe("unchanged");
    expect(fake.ops()).toEqual(["ZjPublicOffers"]);
  });

  it("throws on userErrors", async () => {
    const fake = fakeGql({
      ZjPublicOffers: shop(null),
      ZjSetPublicOffers: () => ({ metafieldsSet: { userErrors: [{ field: ["value"], message: "bad" }] } }),
    });
    await expect(publishOffers(fake.gql, [rule()])).rejects.toThrow("bad");
  });
});
