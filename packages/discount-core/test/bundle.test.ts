import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluateRule, MAX_CART_LINES_BY_TYPE, type BundleConfig, type BundleValue, type CartLine, type EvaluableRule } from "../src";

const MAX_CART_LINES = MAX_CART_LINES_BY_TYPE.BUNDLE;

const RATE1 = { presentmentCurrencyRate: "1.0" };
const SHIRT = "gid://shopify/Product/1";
const JEANS = "gid://shopify/Product/2";
const BELT_V = "gid://shopify/ProductVariant/31";
const BELT = "gid://shopify/Product/3";

function rule(value: BundleValue, o: Partial<BundleConfig> = {}): EvaluableRule {
  return {
    ruleId: "bundle_1",
    title: "Shirt + Jeans",
    config: {
      type: "BUNDLE",
      currencyCode: "USD",
      components: [
        { kind: "PRODUCT", productId: SHIRT, quantity: 1 },
        { kind: "PRODUCT", productId: JEANS, quantity: 1 },
      ],
      value,
      limitPerOrder: 3,
      ...o,
    },
  };
}
const P = (percent: number): BundleValue => ({ kind: "PERCENTAGE", percent });
const AMT = (amountMinor: number): BundleValue => ({ kind: "FIXED_AMOUNT", amountMinor });
const PRICE = (priceMinor: number): BundleValue => ({ kind: "FIXED_PRICE", priceMinor });

let seq = 0;
const line = (productId: string, unit: number, qty = 1, variantId?: string, id?: string): CartLine => ({
  id: id ?? `L${++seq}`,
  quantity: qty,
  unitPriceMinor: unit,
  subtotalMinor: unit * qty,
  productId,
  variantId: variantId ?? `${productId}-v`,
  collectionIds: [],
});
const cart = (lines: CartLine[], currencyCode = "USD") => ({ currencyCode, lines });
const out = (r: ReturnType<typeof evaluateRule>) => r.lines.map((l) => [l.lineId, l.quantity, l.amountMinor]);

describe("complete bundles", () => {
  it("no bundle when a component is missing", () => {
    expect(evaluateRule(rule(P(20)), cart([line(SHIRT, 3000, 4, undefined, "s")]), RATE1).lines).toEqual([]);
  });
  it("exactly one bundle at 20%", () => {
    const r = evaluateRule(rule(P(20)), cart([line(SHIRT, 3000, 1, undefined, "s"), line(JEANS, 5000, 1, undefined, "j")]), RATE1);
    expect(out(r)).toEqual([["s", 1, 600], ["j", 1, 1000]]);
    expect(r.totalMinor).toBe(1600);
    expect(r.discountClass).toBe("PRODUCT");
  });
  it("two bundles", () => {
    const r = evaluateRule(rule(P(20)), cart([line(SHIRT, 3000, 2, undefined, "s"), line(JEANS, 5000, 2, undefined, "j")]), RATE1);
    expect(out(r)).toEqual([["s", 2, 1200], ["j", 2, 2000]]);
  });
  it("extra units outside complete bundles are not discounted", () => {
    const r = evaluateRule(rule(P(20)), cart([line(SHIRT, 3000, 3, undefined, "s"), line(JEANS, 5000, 1, undefined, "j")]), RATE1);
    expect(out(r)).toEqual([["s", 1, 600], ["j", 1, 1000]]);
  });
  it("required quantities above 1 (2 shirts + 1 jeans per bundle)", () => {
    const r = evaluateRule(
      rule(P(10), { components: [{ kind: "PRODUCT", productId: SHIRT, quantity: 2 }, { kind: "PRODUCT", productId: JEANS, quantity: 1 }] }),
      cart([line(SHIRT, 3000, 5, undefined, "s"), line(JEANS, 5000, 3, undefined, "j")]),
      RATE1,
    );
    expect(out(r)).toEqual([["s", 4, 1200], ["j", 2, 1000]]); // floor(5/2)=2, floor(3/1)=3 → 2 bundles
  });
  it("the limit per order caps bundles", () => {
    const r = evaluateRule(rule(P(20), { limitPerOrder: 2 }), cart([line(SHIRT, 3000, 9, undefined, "s"), line(JEANS, 5000, 9, undefined, "j")]), RATE1);
    expect(out(r)).toEqual([["s", 2, 1200], ["j", 2, 2000]]);
  });
  it("matches a variant component only by that variant", () => {
    const r = evaluateRule(
      rule(P(50), { components: [{ kind: "PRODUCT", productId: SHIRT, quantity: 1 }, { kind: "VARIANT", variantId: BELT_V, productId: BELT, quantity: 1 }] }),
      cart([line(SHIRT, 2000, 1, undefined, "s"), line(BELT, 1000, 1, "gid://shopify/ProductVariant/32", "wrong"), line(BELT, 1000, 1, BELT_V, "right")]),
      RATE1,
    );
    expect(out(r)).toEqual([["s", 1, 1000], ["right", 1, 500]]);
  });
});

describe("cheapest units first within a component", () => {
  it("a component with two lines at different prices uses the cheaper line first", () => {
    const r = evaluateRule(
      rule(P(20)),
      cart([line(SHIRT, 4000, 1, "sv1", "s-dear"), line(SHIRT, 3000, 1, "sv2", "s-cheap"), line(JEANS, 5000, 1, undefined, "j")]),
      RATE1,
    );
    expect(out(r)).toEqual([["s-cheap", 1, 600], ["j", 1, 1000]]);
  });
  it("equal prices: the earlier line first", () => {
    const r = evaluateRule(rule(P(20)), cart([line(SHIRT, 3000, 1, "a", "s1"), line(SHIRT, 3000, 1, "b", "s2"), line(JEANS, 5000, 1, undefined, "j")]), RATE1);
    expect(out(r)).toEqual([["s1", 1, 600], ["j", 1, 1000]]);
  });
  it("bundles spill across a component's lines", () => {
    const r = evaluateRule(
      rule(P(10)),
      cart([line(SHIRT, 4000, 2, "a", "dear"), line(SHIRT, 3000, 1, "b", "cheap"), line(JEANS, 5000, 3, undefined, "j")]),
      RATE1,
    );
    expect(out(r)).toEqual([["dear", 2, 800], ["cheap", 1, 300], ["j", 3, 1500]]);
  });
  it("quantity 999: no unit expansion, the limit applies", () => {
    const r = evaluateRule(rule(P(20), { limitPerOrder: 100 }), cart([line(SHIRT, 1999, 999, undefined, "s"), line(JEANS, 2999, 999, undefined, "j")]), RATE1);
    expect(out(r)).toEqual([["s", 100, 40000], ["j", 100, 60000]]); // 20% of 19.99 = 4.00 per unit (half up)
  });
});

describe("discount kinds", () => {
  const twoLines = () => cart([line(SHIRT, 3000, 1, undefined, "s"), line(JEANS, 5000, 1, undefined, "j")]);
  it("fixed amount off each bundle is spread over the lines and adds up exactly", () => {
    const r = evaluateRule(rule(AMT(1001)), twoLines(), RATE1);
    // 10.01 over 30.00 : 50.00 → 375.375 / 625.625 → 375 + 626 (largest remainder)
    expect(out(r)).toEqual([["s", 1, 375], ["j", 1, 626]]);
    expect(r.totalMinor).toBe(1001);
  });
  it("fixed bundle price: discount = bundle total − price", () => {
    const r = evaluateRule(rule(PRICE(6000)), twoLines(), RATE1);
    expect(r.totalMinor).toBe(2000);
    expect(out(r)).toEqual([["s", 1, 750], ["j", 1, 1250]]);
  });
  it("fixed price above the bundle total clamps to no discount (never negative)", () => {
    const r = evaluateRule(rule(PRICE(9000)), twoLines(), RATE1);
    expect(r.lines).toEqual([]);
    expect(r.totalMinor).toBe(0);
  });
  it("fixed amount above the bundle total clamps to the total (bundle free)", () => {
    expect(evaluateRule(rule(AMT(100000)), twoLines(), RATE1).totalMinor).toBe(8000);
  });
  it("bundles with different unit prices get their own discount (fixed price per bundle)", () => {
    const r = evaluateRule(
      rule(PRICE(6000)),
      cart([line(SHIRT, 4000, 1, "a", "dear"), line(SHIRT, 3000, 1, "b", "cheap"), line(JEANS, 5000, 2, undefined, "j")]),
      RATE1,
    );
    // bundle 1: cheap + jeans = 80.00 → 20.00 off; bundle 2: dear + jeans = 90.00 → 30.00 off
    expect(r.totalMinor).toBe(5000);
    expect(out(r)).toEqual([["dear", 1, 1333], ["cheap", 1, 750], ["j", 2, 2917]]);
  });
  it("100% makes the bundle units free", () => {
    expect(evaluateRule(rule(P(100)), twoLines(), RATE1).totalMinor).toBe(8000);
  });
  it("defensive: zero/negative values or bad limits give nothing", () => {
    for (const r of [rule(P(0)), rule(P(20), { limitPerOrder: 0 }), rule(P(20), { components: [{ kind: "PRODUCT", productId: SHIRT, quantity: 0 }] }), rule(P(20), { components: [] })]) {
      expect(evaluateRule(r, twoLines(), RATE1).lines).toEqual([]);
    }
  });
});

describe("currencies, empty carts and the cap", () => {
  it("JPY (exponent 0): fixed bundle price converted from USD at 150", () => {
    const r = evaluateRule(rule(PRICE(5000)), cart([line(SHIRT, 4500, 1, undefined, "s"), line(JEANS, 4500, 1, undefined, "j")], "JPY"), { presentmentCurrencyRate: "150" });
    // $50 = ¥7,500; bundle ¥9,000 → ¥1,500 off, split 750 / 750
    expect(out(r)).toEqual([["s", 1, 750], ["j", 1, 750]]);
  });
  it("KWD (exponent 3): fixed amount converted at 0.307", () => {
    const r = evaluateRule(rule(AMT(1000)), cart([line(SHIRT, 10000, 1, undefined, "s"), line(JEANS, 20000, 1, undefined, "j")], "KWD"), { presentmentCurrencyRate: "0.307" });
    expect(r.totalMinor).toBe(3070); // $10 = 3.070 KWD
    expect(out(r)).toEqual([["s", 1, 1023], ["j", 1, 2047]]);
  });
  it("empty cart → nothing", () => expect(evaluateRule(rule(P(20)), cart([]), RATE1).lines).toEqual([]));
  it(`above ${MAX_CART_LINES} lines → no discount at all`, () => {
    const filler = Array.from({ length: MAX_CART_LINES - 1 }, (_, i) => line(`gid://shopify/Product/9${i}`, 100));
    const base = [line(SHIRT, 3000, 1, undefined, "s"), ...filler];
    expect(evaluateRule(rule(P(20)), cart([...base.slice(0, MAX_CART_LINES - 1), line(JEANS, 5000)]), RATE1).lines).toHaveLength(2);
    expect(evaluateRule(rule(P(20)), cart([...base, line(JEANS, 5000)]), RATE1).lines).toEqual([]);
  });
});

describe("properties", () => {
  const products = [SHIRT, JEANS, BELT];
  const lineArb = fc.record({ p: fc.integer({ min: 0, max: 3 }), unit: fc.integer({ min: 100, max: 100_000 }), qty: fc.integer({ min: 1, max: 999 }) });
  const valueArb = fc.oneof(
    fc.integer({ min: 1, max: 100 }).map(P),
    fc.integer({ min: 1, max: 500_000 }).map(AMT),
    fc.integer({ min: 1, max: 500_000 }).map(PRICE),
  );
  const cfgArb = fc.record({
    q: fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 3, maxLength: 3 }),
    n: fc.integer({ min: 2, max: 3 }),
    limit: fc.integer({ min: 1, max: 100 }),
    value: valueArb,
  });
  const mkRule = (cfg: { q: number[]; n: number; limit: number; value: BundleValue }) =>
    rule(cfg.value, {
      limitPerOrder: cfg.limit,
      components: products.slice(0, cfg.n).map((productId, i) => ({ kind: "PRODUCT" as const, productId, quantity: cfg.q[i] })),
    });
  const mkLines = (specs: Array<{ p: number; unit: number; qty: number }>) =>
    specs.map((s, i) => line(s.p < 3 ? products[s.p] : "gid://shopify/Product/99", s.unit, s.qty, `v${i}`, `L-${i}`));

  it("never negative, never above the discounted units' total, quantities consistent, deterministic", () => {
    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: MAX_CART_LINES }), cfgArb, (specs, cfg) => {
        const lines = mkLines(specs);
        const r = evaluateRule(mkRule(cfg), cart(lines), RATE1);
        expect(evaluateRule(mkRule(cfg), cart(lines), RATE1)).toEqual(r);
        let sum = 0;
        for (const d of r.lines) {
          const l = lines.find((x) => x.id === d.lineId)!;
          expect(d.amountMinor).toBeGreaterThan(0);
          expect(d.quantity!).toBeLessThanOrEqual(l.quantity);
          expect(d.amountMinor).toBeLessThanOrEqual(d.quantity! * l.unitPriceMinor!);
          sum += d.amountMinor;
        }
        expect(r.totalMinor).toBe(sum);
      }),
    );
  });

  it("the same result when line order changes", () => {
    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: MAX_CART_LINES }), cfgArb, fc.integer({ min: 0, max: 1000 }), (specs, cfg, seed) => {
        // distinct unit prices so "ties by line order" can't change which units are used
        const lines = mkLines(specs.map((s, i) => ({ ...s, unit: s.unit * 64 + i })));
        const shuffled = [...lines].sort((a, b) => ((a.unitPriceMinor! * 7 + seed) % 31) - ((b.unitPriceMinor! * 7 + seed) % 31) || a.unitPriceMinor! - b.unitPriceMinor!);
        const key = (r: ReturnType<typeof evaluateRule>) => r.lines.map((l) => `${l.lineId}:${l.quantity}:${l.amountMinor}`).sort();
        const a = evaluateRule(mkRule(cfg), cart(lines), RATE1);
        const b = evaluateRule(mkRule(cfg), cart(shuffled), RATE1);
        expect(b.totalMinor).toBe(a.totalMinor);
        if (cfg.value.kind === "PERCENTAGE") expect(key(b)).toEqual(key(a));
      }),
    );
  });
});

describe("direct use beyond the Function cap", () => {
  it("falls back to a comparator sort for very large carts", async () => {
    const { evaluateBundle } = await import("../src");
    const lines = [...Array.from({ length: 1100 }, (_, i) => line(SHIRT, 10_000 - i, 1, `s${i}`, `S${i}`)), line(JEANS, 5000, 1, undefined, "j")];
    const r = evaluateBundle(rule(P(10)) as never, cart(lines), RATE1);
    expect(r.lines.map((l) => l.lineId)).toEqual(["S1099", "j"]); // cheapest shirt
  });
});
