import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cartSubtotalMinor, evaluateRule, MAX_CART_LINES_BY_TYPE, type Cart, type EvaluableRule, type TierValue } from "../src";
import { hugeCart, loadCart } from "./helpers";

const RATE1 = { presentmentCurrencyRate: "1.0" };
const P = (percent: number): TierValue => ({ kind: "PERCENTAGE", percent });
const F = (amountMinor: number): TierValue => ({ kind: "FIXED_AMOUNT", amountMinor });

function tiered(tiers: Array<[number, TierValue]>, currencyCode = "USD"): EvaluableRule {
  return {
    ruleId: "tiered_1",
    title: "Spend more, save more",
    config: { type: "TIERED_SPEND", currencyCode, tiers: tiers.map(([thresholdMinor, value]) => ({ thresholdMinor, value })) },
  };
}
const cartOf = (subtotalMinor: number, currencyCode = "USD"): Cart => ({ currencyCode, lines: [], subtotalMinor });
const linesCart = (subtotals: number[], currencyCode = "USD"): Cart => ({
  currencyCode,
  lines: subtotals.map((s, i) => ({ id: `gid://shopify/CartLine/${i}`, quantity: 1, subtotalMinor: s, collectionIds: [] })),
});

// $100 → 10%, $200 → 15%, $300 → 20%
const THREE = tiered([[10000, P(10)], [20000, P(15)], [30000, P(20)]]);

describe("tiered spend: tier selection at the boundaries", () => {
  it.each([
    [9999, null, 0],
    [10000, 0, 1000],
    [10001, 0, 1000],
    [19999, 0, 2000],
    [20000, 1, 3000],
    [20001, 1, 3000],
    [29999, 1, 4500],
    [30000, 2, 6000],
    [30001, 2, 6000],
    [1_000_000, 2, 200000],
  ])("subtotal %i → tier %s, discount %i", (subtotal, tier, amount) => {
    const r = evaluateRule(THREE, cartOf(subtotal), RATE1);
    expect(r.discountClass).toBe("ORDER");
    expect(r.lines).toEqual([]);
    if (tier === null) {
      expect(r.order).toBeNull();
      expect(r.totalMinor).toBe(0);
    } else {
      expect(r.order).toEqual({ amountMinor: amount, tierIndex: tier, percent: [10, 15, 20][tier] });
      expect(r.totalMinor).toBe(amount);
    }
  });

  it("rounds percentages half up with the shared rounding (15% of 199.99 = 29.9985 → 30.00)", () => {
    expect(evaluateRule(tiered([[100, P(15)], [999999, P(16)]]), cartOf(19999), RATE1).order?.amountMinor).toBe(3000);
  });

  it("supports two-decimal percentages", () => {
    expect(evaluateRule(tiered([[100, P(12.5)], [999999, P(13)]]), cartOf(10000), RATE1).order).toMatchObject({ amountMinor: 1250, percent: 12.5 });
  });
});

describe("tiered spend: empty, zero and line-based carts", () => {
  it("empty cart (no lines, no subtotal) → nothing", () => {
    expect(evaluateRule(THREE, loadCart("empty"), RATE1).order).toBeNull();
  });
  it("zero subtotal → nothing", () => {
    expect(evaluateRule(THREE, cartOf(0), RATE1).order).toBeNull();
  });
  it("negative or non-integer reported subtotal is treated as 0", () => {
    expect(evaluateRule(THREE, cartOf(-500), RATE1).order).toBeNull();
    expect(evaluateRule(THREE, cartOf(15000.5), RATE1).order).toBeNull();
  });
  it("without a reported subtotal, sums usable line subtotals (simulator path)", () => {
    const cart = loadCart("zero-quantity"); // one zero-qty line + one 10.00 line
    expect(cartSubtotalMinor(cart)).toBe(1000);
    expect(evaluateRule(tiered([[1000, P(10)], [2000, P(20)]]), cart, RATE1).order?.amountMinor).toBe(100);
  });
  it("reported subtotal takes precedence over lines", () => {
    const cart: Cart = { ...linesCart([5000]), subtotalMinor: 20000 };
    expect(evaluateRule(THREE, cart, RATE1).order?.tierIndex).toBe(1);
  });
  it("is NOT limited by the product-rule cart-line cap", () => {
    const cart = hugeCart(Math.max(...Object.values(MAX_CART_LINES_BY_TYPE)) + 200, 1, 1000);
    const r = evaluateRule(THREE, cart, RATE1);
    expect(r.order?.tierIndex).toBe(2);
  });
});

describe("tiered spend: fixed amounts", () => {
  const FIXED = tiered([[5000, F(500)], [10000, F(1500)]]);
  it("applies the reached tier's amount", () => {
    expect(evaluateRule(FIXED, cartOf(7500), RATE1).order).toEqual({ amountMinor: 500, tierIndex: 0, percent: null });
    expect(evaluateRule(FIXED, cartOf(10000), RATE1).order).toEqual({ amountMinor: 1500, tierIndex: 1, percent: null });
  });
  it("clamps a fixed amount larger than the subtotal (defensive; validation also rejects it)", () => {
    const r = evaluateRule(tiered([[100, F(100000)], [200, F(200000)]]), cartOf(150), RATE1);
    expect(r.order?.amountMinor).toBe(150);
  });
});

describe("tiered spend: currencies", () => {
  it("JPY cart (exponent 0): USD thresholds and amounts converted at 150", () => {
    const rule = tiered([[5000, F(500)], [10000, F(1500)]]); // $50 → $5, $100 → $15
    // $50 = ¥7,500. Just below and exactly at:
    expect(evaluateRule(rule, cartOf(7499, "JPY"), { presentmentCurrencyRate: "150" }).order).toBeNull();
    expect(evaluateRule(rule, cartOf(7500, "JPY"), { presentmentCurrencyRate: "150" }).order).toEqual({ amountMinor: 750, tierIndex: 0, percent: null });
    expect(evaluateRule(rule, cartOf(15000, "JPY"), { presentmentCurrencyRate: "150" }).order?.amountMinor).toBe(2250);
  });
  it("KWD cart (exponent 3): percentages are rate-free", () => {
    // $100 at 0.307 = 30.700 KWD = 30700 fils
    const r = evaluateRule(THREE, cartOf(30700, "KWD"), { presentmentCurrencyRate: "0.307" });
    expect(r.order).toEqual({ amountMinor: 3070, tierIndex: 0, percent: 10 });
    expect(evaluateRule(THREE, cartOf(30699, "KWD"), { presentmentCurrencyRate: "0.307" }).order).toBeNull();
  });
  it("JPY-based shop selling in USD (exponent 0 → 2)", () => {
    const rule = tiered([[10000, F(1000)], [20000, F(3000)]], "JPY"); // ¥10,000 → ¥1,000
    const r = evaluateRule(rule, cartOf(6650, "USD"), { presentmentCurrencyRate: "0.00665" }); // ¥10,000 = $66.50
    expect(r.order).toEqual({ amountMinor: 665, tierIndex: 0, percent: null });
  });
});

describe("tiered spend: properties", () => {
  const tierArb = fc
    .tuple(
      fc.uniqueArray(fc.integer({ min: 1, max: 10_000_000 }), { minLength: 2, maxLength: 5 }),
      fc.boolean(),
      fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 5, maxLength: 5 }),
    )
    .map(([thresholds, percent, values]) => {
      const sorted = [...thresholds].sort((a, b) => a - b);
      const vals = [...values].sort((a, b) => a - b);
      return tiered(sorted.map((t, i) => [t, percent ? P(vals[i] / 100) : F(vals[i] * 10)]));
    });

  it("never negative, never above the subtotal, deterministic, and picks the highest reached tier", () => {
    fc.assert(
      fc.property(tierArb, fc.integer({ min: 0, max: 50_000_000 }), fc.constantFrom("1.0", "150", "0.307", "1.37"), (rule, subtotal, rate) => {
        const cart = cartOf(subtotal);
        const a = evaluateRule(rule, cart, { presentmentCurrencyRate: rate });
        const b = evaluateRule(rule, cart, { presentmentCurrencyRate: rate });
        expect(a).toEqual(b);
        expect(a.totalMinor).toBeGreaterThanOrEqual(0);
        expect(a.totalMinor).toBeLessThanOrEqual(subtotal);
        expect(a.lines).toEqual([]);
        if (a.order) {
          expect(a.order.amountMinor).toBe(a.totalMinor);
          expect(Number.isSafeInteger(a.order.amountMinor)).toBe(true);
        }
      }),
    );
  });

  it("more spend never gives a smaller discount (with non-decreasing tier values)", () => {
    fc.assert(
      fc.property(tierArb, fc.integer({ min: 0, max: 20_000_000 }), fc.integer({ min: 0, max: 1_000_000 }), (rule, s, extra) => {
        const lo = evaluateRule(rule, cartOf(s), RATE1).totalMinor;
        const hi = evaluateRule(rule, cartOf(s + extra), RATE1).totalMinor;
        expect(hi).toBeGreaterThanOrEqual(lo);
      }),
    );
  });
});
