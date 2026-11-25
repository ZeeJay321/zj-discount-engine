import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluateRule, MAX_CART_LINES_BY_TYPE, type BuyXGetYConfig, type Cart, type CartLine, type EvaluableRule } from "../src";
import { C100 } from "./helpers";

const MAX_CART_LINES = MAX_CART_LINES_BY_TYPE.BUY_X_GET_Y;

const RATE1 = { presentmentCurrencyRate: "1.0" };

function rule(o: Partial<BuyXGetYConfig> = {}): EvaluableRule {
  return {
    ruleId: "bogo_1",
    title: "Buy 2 get 1 free",
    config: {
      type: "BUY_X_GET_Y",
      target: { kind: "COLLECTIONS", collectionIds: [C100] },
      buyQuantity: 2,
      getQuantity: 1,
      percent: 100,
      limitPerOrder: 100,
      ...o,
    },
  };
}
/** line(n, unitPrice, qty, inSet) — ids "L<n>" */
const line = (n: number, unit: number, qty = 1, inSet = true, productId?: string): CartLine => ({
  id: `L${n}`,
  quantity: qty,
  unitPriceMinor: unit,
  subtotalMinor: unit * qty,
  productId: productId ?? `gid://shopify/Product/${n}`,
  collectionIds: inSet ? [C100] : [],
});
const cart = (lines: CartLine[], currencyCode = "USD"): Cart => ({ currencyCode, lines });
const out = (r: ReturnType<typeof evaluateRule>) => r.lines.map((l) => [l.lineId, l.quantity, l.amountMinor]);

describe("buy 2 get 1 free: units just below, at and above a full set", () => {
  it.each([
    [1, []],
    [2, []],
    [3, [["L1", 1, 1000]]],
    [4, [["L1", 1, 1000]]],
    [5, [["L1", 1, 1000]]],
    [6, [["L1", 2, 2000]]],
    [7, [["L1", 2, 2000]]],
    [9, [["L1", 3, 3000]]],
  ])("%i units of one line → %j", (qty, expected) => {
    const r = evaluateRule(rule(), cart([line(1, 1000, qty)]), RATE1);
    expect(r.discountClass).toBe("PRODUCT");
    expect(r.order).toBeNull();
    expect(out(r)).toEqual(expected);
    expect(r.totalMinor).toBe((expected as Array<[string, number, number]>).reduce((a, x) => a + x[2], 0));
  });
});

describe("which units are discounted", () => {
  it("the example: units 10, 20, 30, 40 → one set, the 10 unit is free (whatever the line order)", () => {
    const r = evaluateRule(rule(), cart([line(1, 3000), line(2, 1000), line(3, 4000), line(4, 2000)]), RATE1);
    expect(out(r)).toEqual([["L2", 1, 1000]]);
  });
  it("6 mixed units → two sets → the two cheapest are free", () => {
    const r = evaluateRule(rule(), cart([line(1, 6000), line(2, 2000), line(3, 5000), line(4, 1000), line(5, 4000), line(6, 3000)]), RATE1);
    expect(out(r)).toEqual([["L2", 1, 2000], ["L4", 1, 1000]]);
    expect(r.totalMinor).toBe(3000);
  });
  it("equal prices: the earlier line wins the tie", () => {
    const r = evaluateRule(rule(), cart([line(1, 5000), line(2, 1000), line(3, 1000)]), RATE1);
    expect(out(r)).toEqual([["L2", 1, 1000]]);
  });
  it("equal prices across quantities: units come from the earlier line first", () => {
    const r = evaluateRule(rule({ buyQuantity: 1, getQuantity: 1 }), cart([line(1, 1000, 2), line(2, 1000, 2)]), RATE1);
    expect(out(r)).toEqual([["L1", 2, 2000]]);
  });
  it("discounted units spill from the cheapest line into the next one", () => {
    const r = evaluateRule(rule({ buyQuantity: 1, getQuantity: 1 }), cart([line(1, 2000, 5), line(2, 1000, 1)]), RATE1);
    // 6 units → 3 sets → 3 cheapest units: 1 × 10.00 (L2) + 2 × 20.00 (L1)
    expect(out(r)).toEqual([["L1", 2, 4000], ["L2", 1, 1000]]);
  });
  it("lines outside the set neither count nor get discounted", () => {
    const r = evaluateRule(rule(), cart([line(1, 100, 5, false), line(2, 3000, 2), line(3, 2000, 1)]), RATE1);
    expect(out(r)).toEqual([["L3", 1, 2000]]);
    expect(evaluateRule(rule(), cart([line(1, 100, 5, false), line(2, 3000, 2)]), RATE1).lines).toEqual([]);
  });
  it("matches a product-list target by product id", () => {
    const r = evaluateRule(
      rule({ target: { kind: "PRODUCTS", productIds: ["gid://shopify/Product/7"] } }),
      cart([line(1, 500, 3, true, "gid://shopify/Product/1"), line(2, 2000, 3, false, "gid://shopify/Product/7")]),
      RATE1,
    );
    expect(out(r)).toEqual([["L2", 1, 2000]]);
  });
  it("Y > 1 per set (buy 3 get 2 at 50%)", () => {
    const r = evaluateRule(rule({ buyQuantity: 3, getQuantity: 2, percent: 50 }), cart([line(1, 1000, 5), line(2, 400, 5)]), RATE1);
    // 10 units → 2 sets → 4 cheapest units, all from L2 at 2.00 off each
    expect(out(r)).toEqual([["L2", 4, 800]]);
  });
});

describe("limits, quantities and percentages", () => {
  it("limit per order caps the sets", () => {
    const r = evaluateRule(rule({ limitPerOrder: 3 }), cart([line(1, 1000, 12)]), RATE1);
    expect(out(r)).toEqual([["L1", 3, 3000]]);
    expect(out(evaluateRule(rule({ limitPerOrder: 1 }), cart([line(1, 1000, 12)]), RATE1))).toEqual([["L1", 1, 1000]]);
  });
  it("quantity 999 on one line: no unit expansion, limit applies", () => {
    const r = evaluateRule(rule({ limitPerOrder: 100 }), cart([line(1, 1999, 999)]), RATE1);
    expect(out(r)).toEqual([["L1", 100, 199900]]);
    const all = evaluateRule(rule({ buyQuantity: 1, getQuantity: 1, limitPerOrder: 100 }), cart([line(1, 1999, 999), line(2, 500, 999)]), RATE1);
    expect(out(all)).toEqual([["L2", 100, 50000]]);
  });
  it("100% makes the units free; never more than their price", () => {
    expect(evaluateRule(rule(), cart([line(1, 1234, 3)]), RATE1).totalMinor).toBe(1234);
  });
  it("rounds per unit, half up (50% of 9.99 = 5.00 per unit, so 2 units = 10.00, not 9.99)", () => {
    const r = evaluateRule(rule({ buyQuantity: 1, getQuantity: 1, percent: 50 }), cart([line(1, 999, 4)]), RATE1);
    expect(out(r)).toEqual([["L1", 2, 1000]]);
  });
  it("two-decimal percentages (33.33% of 10.00 = 3.33)", () => {
    expect(out(evaluateRule(rule({ percent: 33.33 }), cart([line(1, 1000, 3)]), RATE1))).toEqual([["L1", 1, 333]]);
  });
  it("derives the unit price from subtotal / quantity when missing", () => {
    const l: CartLine = { id: "L1", quantity: 3, subtotalMinor: 3000, collectionIds: [C100] };
    expect(out(evaluateRule(rule(), cart([l]), RATE1))).toEqual([["L1", 1, 1000]]);
  });
  it("defensive: invalid quantities, limits or percentages give nothing", () => {
    const c = cart([line(1, 1000, 9)]);
    for (const o of [{ buyQuantity: 0 }, { getQuantity: 0 }, { limitPerOrder: 0 }, { percent: 0 }, { buyQuantity: 1.5 }, { percent: Number.NaN }]) {
      expect(evaluateRule(rule(o), c, RATE1).lines).toEqual([]);
    }
  });
});

describe("currencies, empty carts and the line cap", () => {
  it("JPY (exponent 0): 50% of ¥1,999 = ¥1,000 per unit (half up)", () => {
    const r = evaluateRule(rule({ percent: 50 }), cart([line(1, 1999, 3)], "JPY"), { presentmentCurrencyRate: "150" });
    expect(out(r)).toEqual([["L1", 1, 1000]]);
    expect(r.currencyCode).toBe("JPY");
  });
  it("KWD (exponent 3): 10% of 12.345 KWD = 1.235 per unit", () => {
    expect(out(evaluateRule(rule({ percent: 10 }), cart([line(1, 12345, 3)], "KWD"), { presentmentCurrencyRate: "0.307" }))).toEqual([["L1", 1, 1235]]);
  });
  it("empty cart and zero-quantity lines → nothing", () => {
    expect(evaluateRule(rule(), cart([]), RATE1).lines).toEqual([]);
    expect(evaluateRule(rule(), cart([{ ...line(1, 1000, 0), subtotalMinor: 0 }]), RATE1).lines).toEqual([]);
  });
  it(`at the cap (${MAX_CART_LINES} lines) it applies; one line more → no discount at all`, () => {
    const lines = Array.from({ length: MAX_CART_LINES }, (_, i) => line(i, 1000 + i, 1));
    expect(evaluateRule(rule(), cart(lines), RATE1).lines).toHaveLength(Math.floor(MAX_CART_LINES / 3));
    expect(evaluateRule(rule(), cart([...lines, line(99, 1, 1)]), RATE1).lines).toEqual([]);
  });
});

describe("properties", () => {
  const lineArb = fc.record({ unit: fc.integer({ min: 100, max: 1_000_000 }), qty: fc.integer({ min: 1, max: 999 }), inSet: fc.boolean() });
  const configArb = fc.record({
    buyQuantity: fc.integer({ min: 1, max: 5 }),
    getQuantity: fc.integer({ min: 1, max: 5 }),
    percent: fc.integer({ min: 1, max: 100 }),
    limitPerOrder: fc.integer({ min: 1, max: 100 }),
  });
  const build = (specs: Array<{ unit: number; qty: number; inSet: boolean }>) => specs.map((s, i) => line(i, s.unit, s.qty, s.inSet));

  it("never negative, never above the discounted units' price, unit count matches, deterministic", () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 0, maxLength: MAX_CART_LINES }), configArb, (specs, cfg) => {
        const lines = build(specs);
        const r = evaluateRule(rule(cfg), cart(lines), RATE1);
        expect(evaluateRule(rule(cfg), cart(lines), RATE1)).toEqual(r);
        const eligibleUnits = lines.filter((l) => l.collectionIds.length).reduce((a, l) => a + l.quantity, 0);
        const sets = Math.min(Math.floor(eligibleUnits / (cfg.buyQuantity + cfg.getQuantity)), cfg.limitPerOrder);
        expect(r.lines.reduce((a, l) => a + (l.quantity ?? 0), 0)).toBe(sets * cfg.getQuantity);
        let total = 0;
        for (const d of r.lines) {
          const l = lines.find((x) => x.id === d.lineId)!;
          expect(d.amountMinor).toBeGreaterThan(0);
          expect(d.amountMinor).toBeLessThanOrEqual((d.quantity ?? 0) * l.unitPriceMinor!);
          expect(d.quantity!).toBeLessThanOrEqual(l.quantity);
          total += d.amountMinor;
        }
        expect(r.totalMinor).toBe(total);
      }),
    );
  });

  it("discounted units are the cheapest eligible units", () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: MAX_CART_LINES }), configArb, (specs, cfg) => {
        const lines = build(specs);
        const r = evaluateRule(rule(cfg), cart(lines), RATE1);
        const discounted = new Map(r.lines.map((d) => [d.lineId, d.quantity!]));
        const maxDiscounted = Math.max(-1, ...lines.filter((l) => discounted.has(l.id)).map((l) => l.unitPriceMinor!));
        const undiscountedUnits = lines.filter((l) => l.collectionIds.length && (discounted.get(l.id) ?? 0) < l.quantity);
        for (const l of undiscountedUnits) expect(l.unitPriceMinor!).toBeGreaterThanOrEqual(maxDiscounted);
      }),
    );
  });

  it("with distinct prices, line order doesn't change the result", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 100, max: 1_000_000 }), { minLength: 1, maxLength: MAX_CART_LINES }),
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: MAX_CART_LINES, maxLength: MAX_CART_LINES }),
        configArb,
        fc.integer(),
        (prices, qtys, cfg, seed) => {
          const lines = prices.map((p, i) => line(i, p, qtys[i]));
          const shuffled = [...lines].sort((a, b) => ((a.unitPriceMinor! * 31 + seed) % 97) - ((b.unitPriceMinor! * 31 + seed) % 97));
          const key = (r: ReturnType<typeof evaluateRule>) => r.lines.map((l) => `${l.lineId}:${l.quantity}:${l.amountMinor}`).sort();
          const a = evaluateRule(rule(cfg), cart(lines), RATE1);
          const b = evaluateRule(rule(cfg), cart(shuffled), RATE1);
          expect(key(b)).toEqual(key(a));
          expect(b.totalMinor).toBe(a.totalMinor);
        },
      ),
    );
  });
});

describe("direct evaluator use (simulator beyond the Function cap)", () => {
  it("falls back to a comparator sort for very large carts and stays correct", async () => {
    const { evaluateBuyXGetY } = await import("../src");
    const lines = Array.from({ length: 1100 }, (_, i) => line(i, 100_000 - i, 1));
    const r = evaluateBuyXGetY(rule({ limitPerOrder: 2 }) as never, cart(lines), RATE1);
    // two cheapest units: the last two lines
    expect(r.lines.map((l) => l.lineId).sort()).toEqual(["L1098", "L1099"]);
  });
});
