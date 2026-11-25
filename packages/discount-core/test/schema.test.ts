import { describe, expect, it } from "vitest";
import { discountClassesFor, parseConfig, parseMetafieldPayload, RULE_CONFIG_SCHEMA_VERSION, toMetafieldPayload, type AmountOffProductsConfig } from "../src";
import { C100, C200, fixed, pct, rule } from "./helpers";

describe("metafield payload", () => {
  it("puts collectionIds at the top level for input variables and round-trips", () => {
    const r = rule(pct(10), [C100, C200]);
    const payload = toMetafieldPayload({ id: "rule_1", title: "Ten off", config: r.config });
    expect(payload.collectionIds).toEqual([C100, C200]);
    expect(payload.schemaVersion).toBe(RULE_CONFIG_SCHEMA_VERSION);
    const parsed = parseMetafieldPayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed).toEqual({ ok: true, value: payload });
  });

  it("round-trips a fixed amount config", () => {
    const payload = toMetafieldPayload({ id: "r", title: "t", config: rule(fixed(500, true)).config });
    expect(parseMetafieldPayload(payload)).toEqual({ ok: true, value: payload });
  });

  it("copies collectionIds rather than sharing the array", () => {
    const cfg = rule(pct(10)).config as AmountOffProductsConfig;
    const payload = toMetafieldPayload({ id: "r", title: "t", config: cfg });
    payload.collectionIds.push("x");
    expect((cfg.target as { collectionIds: string[] }).collectionIds).toEqual([C100]);
  });

  it("reports discount classes", () => expect(discountClassesFor({ config: rule(pct(1)).config })).toEqual(["PRODUCT"]));

  const good = toMetafieldPayload({ id: "r", title: "t", config: rule(pct(10)).config });
  it.each([
    ["null", null],
    ["array", []],
    ["unknown version", { ...good, schemaVersion: 99 }],
    ["missing ruleId", { ...good, ruleId: undefined }],
    ["missing title", { ...good, title: 5 }],
    ["missing collectionIds", { ...good, collectionIds: "x" }],
    ["config not object", { ...good, config: "x" }],
    ["unknown type", { ...good, config: { ...good.config, type: "BOGO" } }],
    ["bad target", { ...good, config: { ...good.config, target: { kind: "SKUS", skus: [] } } }],
    ["products target without ids", { ...good, config: { ...good.config, target: { kind: "PRODUCTS" } } }],
    ["bad target ids", { ...good, config: { ...good.config, target: { kind: "COLLECTIONS", collectionIds: [1] } } }],
    ["value missing", { ...good, config: { ...good.config, value: null } }],
    ["percent NaN-ish", { ...good, config: { ...good.config, value: { kind: "PERCENTAGE", percent: "10" } } }],
    ["fixed missing currency", { ...good, config: { ...good.config, value: { kind: "FIXED_AMOUNT", amountMinor: 5, appliesToEachItem: true } } }],
    ["fixed float amount", { ...good, config: { ...good.config, value: { kind: "FIXED_AMOUNT", amountMinor: 5.5, currencyCode: "USD", appliesToEachItem: true } } }],
  ])("rejects %s", (_name, json) => {
    expect(parseMetafieldPayload(json).ok).toBe(false);
  });

  it("parseConfig rejects non-objects", () => expect(parseConfig(undefined).ok).toBe(false));
});

describe("schema versions", () => {
  const v1 = {
    schemaVersion: 1,
    ruleId: "old",
    title: "Old rule",
    collectionIds: [C100],
    config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds: [C100] }, value: { kind: "PERCENTAGE", percent: 10 } },
  };
  it("still reads v1 payloads (discounts saved before tiered spend existed)", () => {
    const r = parseMetafieldPayload(v1);
    expect(r.ok && r.value).toMatchObject({ schemaVersion: 1, ruleId: "old" });
  });
  it("rejects a tiered config inside a v1 payload", () => {
    const tiered = { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 100, value: { kind: "PERCENTAGE", percent: 5 } }] };
    expect(parseMetafieldPayload({ ...v1, config: tiered }).ok).toBe(false);
  });
  it("writes the current version with no collections for tiered spend", () => {
    const config = {
      type: "TIERED_SPEND" as const,
      currencyCode: "USD",
      tiers: [
        { thresholdMinor: 10000, value: { kind: "PERCENTAGE" as const, percent: 10 } },
        { thresholdMinor: 20000, value: { kind: "PERCENTAGE" as const, percent: 15 } },
      ],
    };
    const payload = toMetafieldPayload({ id: "t", title: "Tiers", config });
    expect(payload).toMatchObject({ schemaVersion: RULE_CONFIG_SCHEMA_VERSION, collectionIds: [] });
    expect(parseMetafieldPayload(JSON.parse(JSON.stringify(payload)))).toEqual({ ok: true, value: payload });
    expect(discountClassesFor({ config })).toEqual(["ORDER"]);
  });
  it("round-trips fixed-amount tiers", () => {
    const config = {
      type: "TIERED_SPEND" as const,
      currencyCode: "JPY",
      tiers: [
        { thresholdMinor: 5000, value: { kind: "FIXED_AMOUNT" as const, amountMinor: 500 } },
        { thresholdMinor: 10000, value: { kind: "FIXED_AMOUNT" as const, amountMinor: 1500 } },
      ],
    };
    const payload = toMetafieldPayload({ id: "t", title: "Tiers", config });
    expect(parseMetafieldPayload(payload)).toEqual({ ok: true, value: payload });
  });
  const tieredPayload = (config: unknown) => ({ schemaVersion: 2, ruleId: "t", title: "t", collectionIds: [], config });
  it.each([
    ["no currency", { type: "TIERED_SPEND", tiers: [{ thresholdMinor: 1, value: { kind: "PERCENTAGE", percent: 1 } }] }],
    ["no tiers", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [] }],
    ["tiers not array", { type: "TIERED_SPEND", currencyCode: "USD", tiers: "x" }],
    ["bad threshold", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 1.5, value: { kind: "PERCENTAGE", percent: 1 } }] }],
    ["tier not object", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [null] }],
    ["bad value", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 1, value: { kind: "PERCENTAGE", percent: "1" } }] }],
    ["bad fixed", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 1, value: { kind: "FIXED_AMOUNT", amountMinor: 1.2 } }] }],
  ])("rejects tiered config with %s", (_n, config) => {
    expect(parseMetafieldPayload(tieredPayload(config)).ok).toBe(false);
  });
});

describe("schema v3: buy X get Y and product targets", () => {
  const bogo = {
    type: "BUY_X_GET_Y" as const,
    target: { kind: "PRODUCTS" as const, productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"] },
    buyQuantity: 2,
    getQuantity: 1,
    percent: 100,
    limitPerOrder: 3,
  };
  it("round-trips a BOGO rule with a product-list target (no collection variable)", () => {
    const payload = toMetafieldPayload({ id: "b", title: "B2G1", config: bogo });
    expect(payload).toMatchObject({ schemaVersion: RULE_CONFIG_SCHEMA_VERSION, collectionIds: [] });
    expect(parseMetafieldPayload(JSON.parse(JSON.stringify(payload)))).toEqual({ ok: true, value: payload });
    expect(discountClassesFor({ config: bogo })).toEqual(["PRODUCT"]);
  });
  it("puts BOGO collection targets in the input variable", () => {
    const config = { ...bogo, target: { kind: "COLLECTIONS" as const, collectionIds: [C100] } };
    expect(toMetafieldPayload({ id: "b", title: "B", config }).collectionIds).toEqual([C100]);
  });
  it("round-trips amount-off with a product-list target", () => {
    const config = { type: "AMOUNT_OFF_PRODUCTS" as const, target: { kind: "PRODUCTS" as const, productIds: ["gid://shopify/Product/9"] }, value: { kind: "PERCENTAGE" as const, percent: 5 } };
    const payload = toMetafieldPayload({ id: "a", title: "A", config });
    expect(parseMetafieldPayload(payload)).toEqual({ ok: true, value: payload });
  });
  it.each([
    ["BOGO in a v2 payload", 2, bogo],
    ["product target in a v1 payload", 1, { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "PRODUCTS", productIds: ["gid://shopify/Product/9"] }, value: { kind: "PERCENTAGE", percent: 5 } }],
    ["product target in a v2 payload", 2, { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "PRODUCTS", productIds: ["gid://shopify/Product/9"] }, value: { kind: "PERCENTAGE", percent: 5 } }],
  ])("rejects %s (older versions can't contain it)", (_n, schemaVersion, config) => {
    expect(parseMetafieldPayload({ schemaVersion, ruleId: "r", title: "t", collectionIds: [], config }).ok).toBe(false);
  });
  it("still reads v2 tiered payloads", () => {
    const config = { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 1, value: { kind: "PERCENTAGE", percent: 1 } }] };
    expect(parseMetafieldPayload({ schemaVersion: 2, ruleId: "r", title: "t", collectionIds: [], config }).ok).toBe(true);
  });
  it.each([
    ["bad target", { ...bogo, target: { kind: "X" } }],
    ["string quantity", { ...bogo, buyQuantity: "2" }],
    ["missing limit", { ...bogo, limitPerOrder: undefined }],
    ["NaN percent", { ...bogo, percent: Number.NaN }],
  ])("rejects BOGO with %s", (_n, config) => {
    expect(parseMetafieldPayload({ schemaVersion: 3, ruleId: "r", title: "t", collectionIds: [], config }).ok).toBe(false);
  });
});

describe("target helpers", () => {
  it("productIdsOf / collectionIdsOf / targetOf", async () => {
    const { productIdsOf, collectionIdsOf, targetOf } = await import("../src");
    const products = { type: "BUY_X_GET_Y" as const, target: { kind: "PRODUCTS" as const, productIds: ["gid://shopify/Product/1"] }, buyQuantity: 1, getQuantity: 1, percent: 50, limitPerOrder: 1 };
    expect(productIdsOf(products)).toEqual(["gid://shopify/Product/1"]);
    expect(collectionIdsOf(products)).toEqual([]);
    const tiered = { type: "TIERED_SPEND" as const, currencyCode: "USD", tiers: [] };
    expect(targetOf(tiered)).toBeNull();
    expect(productIdsOf(tiered)).toEqual([]);
  });
});

describe("schema v4: bundles", () => {
  const bundle = {
    type: "BUNDLE" as const,
    currencyCode: "USD",
    components: [
      { kind: "PRODUCT" as const, productId: "gid://shopify/Product/1", quantity: 1 },
      { kind: "VARIANT" as const, variantId: "gid://shopify/ProductVariant/22", productId: "gid://shopify/Product/2", quantity: 2 },
    ],
    value: { kind: "FIXED_PRICE" as const, priceMinor: 5000 },
    limitPerOrder: 3,
  };
  it("round-trips a bundle (current version, PRODUCT class, no collection variable)", () => {
    const payload = toMetafieldPayload({ id: "b", title: "Kit", config: bundle });
    expect(payload).toMatchObject({ schemaVersion: RULE_CONFIG_SCHEMA_VERSION, collectionIds: [] });
    expect(parseMetafieldPayload(JSON.parse(JSON.stringify(payload)))).toEqual({ ok: true, value: payload });
    expect(discountClassesFor({ config: bundle })).toEqual(["PRODUCT"]);
  });
  it("still reads a v4 bundle payload", () => {
    expect(parseMetafieldPayload({ schemaVersion: 4, ruleId: "b", title: "Kit", collectionIds: [], config: bundle }).ok).toBe(true);
  });
  it.each([
    ["percentage", { kind: "PERCENTAGE", percent: 20 }],
    ["fixed amount", { kind: "FIXED_AMOUNT", amountMinor: 500 }],
  ])("round-trips the %s kind", (_n, value) => {
    const payload = toMetafieldPayload({ id: "b", title: "Kit", config: { ...bundle, value } as never });
    expect(parseMetafieldPayload(payload).ok).toBe(true);
  });
  it("rejects a bundle inside a v3 payload", () => {
    expect(parseMetafieldPayload({ schemaVersion: 3, ruleId: "r", title: "t", collectionIds: [], config: bundle }).ok).toBe(false);
  });
  it("still reads v3 buy X get Y payloads", () => {
    const config = { type: "BUY_X_GET_Y", target: { kind: "PRODUCTS", productIds: ["gid://shopify/Product/1"] }, buyQuantity: 1, getQuantity: 1, percent: 50, limitPerOrder: 1 };
    expect(parseMetafieldPayload({ schemaVersion: 3, ruleId: "r", title: "t", collectionIds: [], config }).ok).toBe(true);
  });
  it.each([
    ["no currency", { ...bundle, currencyCode: undefined }],
    ["no components", { ...bundle, components: [] }],
    ["component not an object", { ...bundle, components: [null] }],
    ["component without productId", { ...bundle, components: [{ kind: "PRODUCT", quantity: 1 }] }],
    ["variant without variantId", { ...bundle, components: [{ kind: "VARIANT", productId: "p", quantity: 1 }] }],
    ["unknown component kind", { ...bundle, components: [{ kind: "SKU", productId: "p", quantity: 1 }] }],
    ["bad value", { ...bundle, value: { kind: "FIXED_PRICE", priceMinor: 1.5 } }],
    ["missing limit", { ...bundle, limitPerOrder: undefined }],
  ])("rejects a bundle with %s", (_n, config) => {
    expect(parseMetafieldPayload({ schemaVersion: 4, ruleId: "r", title: "t", collectionIds: [], config }).ok).toBe(false);
  });
  it("resourceIdsOf lists bundle components (variants by variant id)", async () => {
    const { resourceIdsOf } = await import("../src");
    expect(resourceIdsOf(bundle)).toEqual(["gid://shopify/Product/1", "gid://shopify/ProductVariant/22"]);
    expect(resourceIdsOf({ type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds: ["c"] }, value: { kind: "PERCENTAGE", percent: 1 } })).toEqual(["c"]);
  });
});

describe("schema v5: free shipping", () => {
  const ship = {
    type: "FREE_SHIPPING" as const,
    currencyCode: "USD",
    thresholdMinor: 10000,
    percent: 100,
    maxAmountMinor: null as number | null,
    appliesTo: "ALL" as const,
  };
  it("round-trips free shipping (v5, SHIPPING class)", () => {
    const payload = toMetafieldPayload({ id: "s", title: "Free ship", config: ship });
    expect(payload).toMatchObject({ schemaVersion: 5, collectionIds: [] });
    expect(parseMetafieldPayload(JSON.parse(JSON.stringify(payload)))).toEqual({ ok: true, value: payload });
    expect(discountClassesFor({ config: ship })).toEqual(["SHIPPING"]);
  });
  it("round-trips with a max amount and CHEAPEST", () => {
    const config = { ...ship, percent: 50, maxAmountMinor: 500, appliesTo: "CHEAPEST" as const };
    const payload = toMetafieldPayload({ id: "s", title: "Ship", config });
    expect(parseMetafieldPayload(payload)).toEqual({ ok: true, value: payload });
  });
  it("rejects free shipping inside a v4 payload", () => {
    expect(parseMetafieldPayload({ schemaVersion: 4, ruleId: "r", title: "t", collectionIds: [], config: ship }).ok).toBe(false);
  });
  it.each([
    ["no currency", { ...ship, currencyCode: undefined }],
    ["bad threshold", { ...ship, thresholdMinor: 1.5 }],
    ["bad percent", { ...ship, percent: "100" }],
    ["bad max", { ...ship, maxAmountMinor: 1.5 }],
    ["bad appliesTo", { ...ship, appliesTo: "SOME" }],
  ])("rejects free shipping with %s", (_n, config) => {
    expect(parseMetafieldPayload({ schemaVersion: 5, ruleId: "r", title: "t", collectionIds: [], config }).ok).toBe(false);
  });
});
