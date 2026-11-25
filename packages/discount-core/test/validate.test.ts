import { describe, expect, it } from "vitest";
import { rangesOverlap, validateRule, type OtherRule, type RuleDraft } from "../src";
import { C100, fixed, pct } from "./helpers";

function draft(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return {
    title: "Winter sale",
    enabled: true,
    priority: 10,
    startsAt: "2026-12-01T00:00:00.000Z",
    endsAt: "2026-12-31T23:59:59.000Z",
    combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
    config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds: [C100] }, value: pct(10) },
    ...overrides,
  };
}
const fields = (d: RuleDraft, others: OtherRule[] = []) => validateRule(d, others).map((e) => e.field);
const withValue = (value: unknown) =>
  draft({ config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds: [C100] }, value } as RuleDraft["config"] });
const withCollections = (collectionIds: string[]) =>
  draft({ config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds }, value: pct(10) } });

describe("validateRule", () => {
  it("accepts a valid percentage rule", () => expect(validateRule(draft())).toEqual([]));
  it("accepts a valid fixed rule and an open-ended rule", () => {
    expect(validateRule(withValue(fixed(500, true)))).toEqual([]);
    expect(validateRule(draft({ endsAt: null }))).toEqual([]);
  });

  it.each([
    ["empty title", { title: "  " }, "title"],
    ["long title", { title: "x".repeat(256) }, "title"],
    ["negative priority", { priority: -1 }, "priority"],
    ["fractional priority", { priority: 1.5 }, "priority"],
    ["huge priority", { priority: 1001 }, "priority"],
    ["missing start", { startsAt: "" }, "startsAt"],
    ["bad end", { endsAt: "nope" }, "endsAt"],
    ["end before start", { endsAt: "2026-11-30T00:00:00.000Z" }, "endsAt"],
    ["end equals start", { endsAt: "2026-12-01T00:00:00.000Z" }, "endsAt"],
  ])("rejects %s", (_n, o, field) => expect(fields(draft(o as Partial<RuleDraft>))).toContain(field));

  it.each([
    ["zero percent", pct(0)],
    ["negative percent", pct(-5)],
    ["percent above 100", pct(100.01)],
    ["three-decimal percent", pct(10.125)],
    ["NaN percent", pct(Number.NaN)],
  ])("rejects %s", (_n, v) => expect(fields(withValue(v))).toContain("config.value.percent"));

  it("accepts exactly 100% and two-decimal percent", () => {
    expect(validateRule(withValue(pct(100)))).toEqual([]);
    expect(validateRule(withValue(pct(12.34)))).toEqual([]);
  });

  it.each([
    ["zero amount", fixed(0, true), "config.value.amount"],
    ["negative amount", fixed(-100, true), "config.value.amount"],
    ["fractional minor units", fixed(1.5, true), "config.value.amount"],
    ["absurd amount", fixed(1e12, true), "config.value.amount"],
    ["bad currency", fixed(100, true, "usd"), "config.value.currencyCode"],
    ["missing appliesToEachItem", { kind: "FIXED_AMOUNT", amountMinor: 100, currencyCode: "USD" }, "config.value.appliesToEachItem"],
    ["no value kind", { kind: "BOGUS" }, "config.value.kind"],
  ])("rejects %s", (_n, v, field) => expect(fields(withValue(v))).toContain(field));

  it("rejects an unsupported type", () => {
    expect(fields(draft({ config: { type: "BOGO" } as unknown as RuleDraft["config"] }))).toContain("config.type");
  });

  it.each([
    ["no collections", []],
    ["too many collections", Array.from({ length: 51 }, (_, i) => `gid://shopify/Collection/${i}`)],
    ["non-GID collection", ["123"]],
    ["duplicate collections", [C100, C100]],
  ])("rejects %s", (_n, ids) => expect(fields(withCollections(ids))).toContain("config.target.collectionIds"));

  describe("overlap with same priority", () => {
    const other: OtherRule = {
      id: "other",
      title: "Black Friday",
      enabled: true,
      priority: 10,
      startsAt: "2026-12-15T00:00:00.000Z",
      endsAt: null,
    };
    it("rejects overlapping dates at the same priority", () => {
      const errs = validateRule(draft(), [other]);
      expect(errs).toHaveLength(1);
      expect(errs[0].field).toBe("priority");
      expect(errs[0].message).toContain("Black Friday");
    });
    it("allows different priority", () => expect(fields(draft({ priority: 11 }), [other])).toEqual([]));
    it("allows non-overlapping dates", () =>
      expect(fields(draft({ endsAt: "2026-12-15T00:00:00.000Z" }), [other])).toEqual([]));
    it("ignores disabled rules on either side", () => {
      expect(fields(draft(), [{ ...other, enabled: false }])).toEqual([]);
      expect(fields(draft({ enabled: false }), [other])).toEqual([]);
    });
    it("ignores itself when editing", () => expect(fields(draft({ id: "other" }), [other])).toEqual([]));
    it("detects overlap with open-ended draft", () =>
      expect(fields(draft({ endsAt: null, startsAt: "2027-01-01T00:00:00.000Z" }), [other])).toContain("priority"));
    it("skips the overlap check when dates are already invalid", () =>
      expect(fields(draft({ endsAt: "2026-11-01T00:00:00.000Z" }), [other])).toEqual(["endsAt"]));
  });
});

describe("rangesOverlap", () => {
  it.each([
    [0, 10, 10, 20, false],
    [0, 11, 10, 20, true],
    [0, null, 100, 200, true],
    [300, null, 100, 200, false],
    [0, 10, 5, null, true],
    [20, 30, 0, null, true],
  ])("[%d,%s) vs [%d,%s) → %s", (a, b, c, d, out) => expect(rangesOverlap(a, b, c, d)).toBe(out));
});

describe("validateRule — tiered spend", () => {
  const P = (percent: number) => ({ kind: "PERCENTAGE" as const, percent });
  const F = (amountMinor: number) => ({ kind: "FIXED_AMOUNT" as const, amountMinor });
  const tieredDraft = (tiers: Array<[number, ReturnType<typeof P> | ReturnType<typeof F>]>, currencyCode = "USD") =>
    draft({ config: { type: "TIERED_SPEND", currencyCode, tiers: tiers.map(([thresholdMinor, value]) => ({ thresholdMinor, value })) } });
  const f = (d: RuleDraft) => validateRule(d).map((e) => e.field);

  it("accepts 2–5 increasing tiers with non-decreasing values", () => {
    expect(validateRule(tieredDraft([[10000, P(10)], [20000, P(15)], [30000, P(20)]]))).toEqual([]);
    expect(validateRule(tieredDraft([[10000, P(10)], [20000, P(10)]]))).toEqual([]);
    expect(validateRule(tieredDraft([[5000, F(500)], [10000, F(1500)]]))).toEqual([]);
    expect(validateRule(tieredDraft([[1, P(1)], [2, P(2)], [3, P(3)], [4, P(4)], [5, P(100)]]))).toEqual([]);
  });

  it.each([
    ["one tier", [[10000, P(10)]], "config.tiers"],
    ["six tiers", [[1, P(1)], [2, P(2)], [3, P(3)], [4, P(4)], [5, P(5)], [6, P(6)]], "config.tiers"],
    ["equal thresholds", [[10000, P(10)], [10000, P(15)]], "config.tiers.1.threshold"],
    ["decreasing thresholds", [[20000, P(10)], [10000, P(15)]], "config.tiers.1.threshold"],
    ["zero threshold", [[0, P(10)], [10000, P(15)]], "config.tiers.0.threshold"],
    ["negative threshold", [[-1, P(10)], [10000, P(15)]], "config.tiers.0.threshold"],
    ["fractional threshold", [[1.5, P(10)], [10000, P(15)]], "config.tiers.0.threshold"],
    ["huge threshold", [[1, P(10)], [1e12, P(15)]], "config.tiers.1.threshold"],
    ["decreasing percent", [[10000, P(15)], [20000, P(10)]], "config.tiers.1.value"],
    ["percent above 100", [[10000, P(10)], [20000, P(101)]], "config.tiers.1.value"],
    ["zero percent", [[10000, P(0)], [20000, P(10)]], "config.tiers.0.value"],
    ["three-decimal percent", [[10000, P(10.125)], [20000, P(11)]], "config.tiers.0.value"],
    ["decreasing fixed", [[5000, F(1500)], [10000, F(500)]], "config.tiers.1.value"],
    ["zero fixed", [[5000, F(0)], [10000, F(500)]], "config.tiers.0.value"],
    ["fixed above its threshold", [[5000, F(6000)], [10000, F(7000)]], "config.tiers.0.value"],
    ["mixed kinds", [[5000, P(10)], [10000, F(500)]], "config.tiers.1.value"],
  ])("rejects %s", (_n, tiers, field) => {
    expect(f(tieredDraft(tiers as Array<[number, ReturnType<typeof P>]>))).toContain(field);
  });

  it("rejects an invalid currency, empty tiers and an unknown value kind", () => {
    expect(f(tieredDraft([[1, P(1)], [2, P(2)]], "usd"))).toContain("config.currencyCode");
    expect(f(draft({ config: { type: "TIERED_SPEND", currencyCode: "USD", tiers: [] } }))).toContain("config.tiers");
    expect(f(draft({ config: { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 1, value: { kind: "X" } }, { thresholdMinor: 2, value: { kind: "X" } }] } as unknown as RuleDraft["config"] }))).toContain("config.tiers.0.value");
  });

  it("still applies the same-priority overlap check", () => {
    const other = { id: "o", title: "Other", enabled: true, priority: 10, startsAt: "2026-12-01T00:00:00.000Z", endsAt: null };
    expect(validateRule(tieredDraft([[1, P(1)], [2, P(2)]]), [other]).map((e) => e.field)).toContain("priority");
  });
});

describe("validateRule — buy X get Y and product targets", () => {
  const bogo = (o: Record<string, unknown> = {}) =>
    draft({
      config: {
        type: "BUY_X_GET_Y",
        target: { kind: "COLLECTIONS", collectionIds: [C100] },
        buyQuantity: 2,
        getQuantity: 1,
        percent: 100,
        limitPerOrder: 3,
        ...o,
      } as RuleDraft["config"],
    });
  const f = (d: RuleDraft) => validateRule(d).map((e) => e.field);

  it("accepts valid rules with collection or product targets", () => {
    expect(validateRule(bogo())).toEqual([]);
    expect(validateRule(bogo({ target: { kind: "PRODUCTS", productIds: ["gid://shopify/Product/1"] }, percent: 50, limitPerOrder: 100, buyQuantity: 100, getQuantity: 100 }))).toEqual([]);
    expect(validateRule(bogo({ percent: 0.01 }))).toEqual([]);
  });

  it.each([
    ["X = 0", { buyQuantity: 0 }, "config.buyQuantity"],
    ["X fractional", { buyQuantity: 1.5 }, "config.buyQuantity"],
    ["X > 100", { buyQuantity: 101 }, "config.buyQuantity"],
    ["Y = 0", { getQuantity: 0 }, "config.getQuantity"],
    ["Y missing", { getQuantity: undefined }, "config.getQuantity"],
    ["percent 0", { percent: 0 }, "config.percent"],
    ["percent > 100", { percent: 100.5 }, "config.percent"],
    ["percent 3 decimals", { percent: 12.345 }, "config.percent"],
    ["limit 0", { limitPerOrder: 0 }, "config.limitPerOrder"],
    ["limit 101", { limitPerOrder: 101 }, "config.limitPerOrder"],
    ["no collections", { target: { kind: "COLLECTIONS", collectionIds: [] } }, "config.target.collectionIds"],
    ["no products", { target: { kind: "PRODUCTS", productIds: [] } }, "config.target.productIds"],
    ["bad product gid", { target: { kind: "PRODUCTS", productIds: ["gid://shopify/Collection/1"] } }, "config.target.productIds"],
    ["duplicate products", { target: { kind: "PRODUCTS", productIds: ["gid://shopify/Product/1", "gid://shopify/Product/1"] } }, "config.target.productIds"],
    ["too many products", { target: { kind: "PRODUCTS", productIds: Array.from({ length: 101 }, (_, i) => `gid://shopify/Product/${i}`) } }, "config.target.productIds"],
    ["missing target", { target: undefined }, "config.target.collectionIds"],
  ])("rejects %s", (_n, o, field) => expect(f(bogo(o))).toContain(field));

  it("amount-off accepts and validates product-list targets too", () => {
    const amountOff = (productIds: string[]) =>
      draft({ config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "PRODUCTS", productIds }, value: pct(10) } });
    expect(validateRule(amountOff(["gid://shopify/Product/5"]))).toEqual([]);
    expect(f(amountOff([]))).toContain("config.target.productIds");
  });

  it("same-priority overlap check applies to BOGO rules (and any other rule)", () => {
    const other = { id: "o", title: "Other BOGO", enabled: true, priority: 10, startsAt: "2026-12-01T00:00:00.000Z", endsAt: null };
    expect(validateRule(bogo(), [other]).map((e) => e.field)).toContain("priority");
    expect(validateRule(bogo(), [{ ...other, priority: 11 }])).toEqual([]);
  });
});

describe("validateRule — bundles", () => {
  const comp = (n: number, quantity = 1) => ({ kind: "PRODUCT" as const, productId: `gid://shopify/Product/${n}`, quantity });
  const bundle = (o: Record<string, unknown> = {}) =>
    draft({
      config: {
        type: "BUNDLE",
        currencyCode: "USD",
        components: [comp(1), comp(2)],
        value: { kind: "PERCENTAGE", percent: 20 },
        limitPerOrder: 3,
        ...o,
      } as RuleDraft["config"],
    });
  const f = (d: RuleDraft) => validateRule(d).map((e) => e.field);

  it("accepts 2–5 components and every value kind", () => {
    expect(validateRule(bundle())).toEqual([]);
    expect(validateRule(bundle({ components: [comp(1, 10), comp(2), comp(3), comp(4), comp(5)], limitPerOrder: 100 }))).toEqual([]);
    expect(validateRule(bundle({ value: { kind: "FIXED_AMOUNT", amountMinor: 500 } }))).toEqual([]);
    expect(validateRule(bundle({ value: { kind: "FIXED_PRICE", priceMinor: 5000 } }))).toEqual([]);
    expect(validateRule(bundle({ components: [comp(1), { kind: "VARIANT", variantId: "gid://shopify/ProductVariant/9", productId: "gid://shopify/Product/2", quantity: 2 }] }))).toEqual([]);
  });

  it.each([
    ["one component", { components: [comp(1)] }, "config.components"],
    ["six components", { components: [1, 2, 3, 4, 5, 6].map((n) => comp(n)) }, "config.components"],
    ["duplicate product", { components: [comp(1), comp(1)] }, "config.components.1.item"],
    ["duplicate variant", { components: [comp(1), { kind: "VARIANT", variantId: "gid://shopify/ProductVariant/9", productId: "gid://shopify/Product/2", quantity: 1 }, { kind: "VARIANT", variantId: "gid://shopify/ProductVariant/9", productId: "gid://shopify/Product/2", quantity: 1 }] }, "config.components.2.item"],
    ["variant of a whole-product component", { components: [comp(1), { kind: "VARIANT", variantId: "gid://shopify/ProductVariant/9", productId: "gid://shopify/Product/1", quantity: 1 }] }, "config.components.1.item"],
    ["bad product gid", { components: [comp(1), { kind: "PRODUCT", productId: "gid://shopify/Collection/2", quantity: 1 }] }, "config.components.1.item"],
    ["bad variant gid", { components: [comp(1), { kind: "VARIANT", variantId: "x", productId: "gid://shopify/Product/2", quantity: 1 }] }, "config.components.1.item"],
    ["unknown component kind", { components: [comp(1), { kind: "SKU" }] }, "config.components.1.item"],
    ["quantity 0", { components: [comp(1, 0), comp(2)] }, "config.components.0.quantity"],
    ["quantity 11", { components: [comp(1), comp(2, 11)] }, "config.components.1.quantity"],
    ["percent 0", { value: { kind: "PERCENTAGE", percent: 0 } }, "config.value"],
    ["percent > 100", { value: { kind: "PERCENTAGE", percent: 101 } }, "config.value"],
    ["fixed amount 0", { value: { kind: "FIXED_AMOUNT", amountMinor: 0 } }, "config.value"],
    ["fixed price negative", { value: { kind: "FIXED_PRICE", priceMinor: -1 } }, "config.value"],
    ["no value kind", { value: { kind: "X" } }, "config.value"],
    ["limit 0", { limitPerOrder: 0 }, "config.limitPerOrder"],
    ["limit 101", { limitPerOrder: 101 }, "config.limitPerOrder"],
    ["bad currency", { currencyCode: "usd" }, "config.currencyCode"],
  ])("rejects %s", (_n, o, field) => expect(f(bundle(o))).toContain(field));

  it("rejects missing components", () => expect(f(bundle({ components: undefined }))).toContain("config.components"));

  it("same-priority overlap check applies (covers bundles sharing a component)", () => {
    const other = { id: "o", title: "Other bundle", enabled: true, priority: 10, startsAt: "2026-12-01T00:00:00.000Z", endsAt: null };
    expect(f(bundle())).toEqual([]);
    expect(validateRule(bundle(), [other]).map((e) => e.field)).toContain("priority");
  });
});

describe("validateRule — free shipping", () => {
  const ship = (o: Record<string, unknown> = {}) =>
    draft({
      config: {
        type: "FREE_SHIPPING",
        currencyCode: "USD",
        thresholdMinor: 10000,
        percent: 100,
        maxAmountMinor: null,
        appliesTo: "ALL",
        ...o,
      } as RuleDraft["config"],
    });
  const f = (d: RuleDraft) => validateRule(d).map((e) => e.field);

  it("accepts 100%, partial %, max amount, and CHEAPEST", () => {
    expect(validateRule(ship())).toEqual([]);
    expect(validateRule(ship({ percent: 50, maxAmountMinor: 500, appliesTo: "CHEAPEST" }))).toEqual([]);
    expect(validateRule(ship({ percent: 0.01 }))).toEqual([]);
  });

  it.each([
    ["threshold 0", { thresholdMinor: 0 }, "config.thresholdMinor"],
    ["threshold negative", { thresholdMinor: -1 }, "config.thresholdMinor"],
    ["percent 0", { percent: 0 }, "config.percent"],
    ["percent > 100", { percent: 101 }, "config.percent"],
    ["max 0", { maxAmountMinor: 0 }, "config.maxAmountMinor"],
    ["bad appliesTo", { appliesTo: "SOME" }, "config.appliesTo"],
    ["bad currency", { currencyCode: "usd" }, "config.currencyCode"],
  ])("rejects %s", (_n, o, field) => expect(f(ship(o))).toContain(field));

  it("same-priority overlap with another free-shipping rule", () => {
    const other = { id: "o", title: "Other ship", enabled: true, priority: 10, startsAt: "2026-12-01T00:00:00.000Z", endsAt: null };
    expect(validateRule(ship(), [other]).map((e) => e.field)).toContain("priority");
    expect(validateRule(ship(), [{ ...other, priority: 11 }])).toEqual([]);
  });
});
