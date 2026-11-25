import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  evaluateRule,
  MAX_CART_LINES_BY_TYPE,
  type Cart,
  type DeliveryGroup,
  type EvaluableRule,
  type FreeShippingAppliesTo,
} from "../src";
import { hugeCart } from "./helpers";

const RATE1 = { presentmentCurrencyRate: "1.0" };

function freeShip(
  opts: {
    thresholdMinor?: number;
    percent?: number;
    maxAmountMinor?: number | null;
    appliesTo?: FreeShippingAppliesTo;
    currencyCode?: string;
  } = {},
): EvaluableRule {
  return {
    ruleId: "ship_1",
    title: "Free shipping over threshold",
    config: {
      type: "FREE_SHIPPING",
      currencyCode: opts.currencyCode ?? "USD",
      thresholdMinor: opts.thresholdMinor ?? 10000,
      percent: opts.percent ?? 100,
      maxAmountMinor: opts.maxAmountMinor === undefined ? null : opts.maxAmountMinor,
      appliesTo: opts.appliesTo ?? "ALL",
    },
  };
}

function cartOf(
  subtotalMinor: number,
  groups: DeliveryGroup[],
  currencyCode = "USD",
): Cart {
  return { currencyCode, lines: [], subtotalMinor, deliveryGroups: groups };
}

const oneGroup = (...opts: Array<[string, number]>): DeliveryGroup[] => [
  { options: opts.map(([handle, costMinor]) => ({ handle, costMinor })) },
];

describe("free shipping: threshold boundaries", () => {
  const rule = freeShip({ thresholdMinor: 10000, percent: 100 });
  const groups = oneGroup(["standard", 500], ["express", 1500]);

  it.each([
    [9999, 0],
    [10000, 2000],
    [10001, 2000],
    [50_000, 2000],
  ])("subtotal %i → total %i", (subtotal, total) => {
    const r = evaluateRule(rule, cartOf(subtotal, groups), RATE1);
    expect(r.discountClass).toBe("SHIPPING");
    expect(r.lines).toEqual([]);
    expect(r.order).toBeNull();
    expect(r.totalMinor).toBe(total);
    if (total === 0) expect(r.shipping).toEqual([]);
    else {
      expect(r.shipping).toEqual([
        { handle: "standard", amountMinor: 500, percent: 100 },
        { handle: "express", amountMinor: 1500, percent: 100 },
      ]);
    }
  });
});

describe("free shipping: empty and zero carts", () => {
  const rule = freeShip();
  it("no delivery groups → nothing", () => {
    expect(evaluateRule(rule, cartOf(20000, []), RATE1).shipping).toEqual([]);
  });
  it("missing deliveryGroups → nothing", () => {
    expect(evaluateRule(rule, { currencyCode: "USD", lines: [], subtotalMinor: 20000 }, RATE1).shipping).toEqual([]);
  });
  it("zero subtotal → nothing", () => {
    expect(evaluateRule(rule, cartOf(0, oneGroup(["s", 500])), RATE1).shipping).toEqual([]);
  });
  it("empty cart (no subtotal) → nothing", () => {
    expect(evaluateRule(rule, { currencyCode: "USD", lines: [], deliveryGroups: oneGroup(["s", 500]) }, RATE1).shipping).toEqual([]);
  });
  it("zero-cost options are skipped", () => {
    expect(evaluateRule(rule, cartOf(20000, oneGroup(["free", 0], ["paid", 800])), RATE1).shipping).toEqual([
      { handle: "paid", amountMinor: 800, percent: 100 },
    ]);
  });
});

describe("free shipping: percentages and max clamp", () => {
  it("50% of each option", () => {
    const r = evaluateRule(freeShip({ percent: 50 }), cartOf(20000, oneGroup(["a", 1000], ["b", 400])), RATE1);
    expect(r.shipping).toEqual([
      { handle: "a", amountMinor: 500, percent: 50 },
      { handle: "b", amountMinor: 200, percent: 50 },
    ]);
    expect(r.totalMinor).toBe(700);
  });
  it("max amount clamps and drops percent (send as fixed)", () => {
    const r = evaluateRule(
      freeShip({ percent: 100, maxAmountMinor: 300 }),
      cartOf(20000, oneGroup(["standard", 500], ["express", 1500])),
      RATE1,
    );
    expect(r.shipping).toEqual([
      { handle: "standard", amountMinor: 300, percent: null },
      { handle: "express", amountMinor: 300, percent: null },
    ]);
  });
  it("max above the percent discount leaves percent intact", () => {
    const r = evaluateRule(
      freeShip({ percent: 50, maxAmountMinor: 10000 }),
      cartOf(20000, oneGroup(["a", 1000])),
      RATE1,
    );
    expect(r.shipping).toEqual([{ handle: "a", amountMinor: 500, percent: 50 }]);
  });
});

describe("free shipping: ALL vs CHEAPEST and multiple groups", () => {
  it("CHEAPEST picks the lowest cost; ties keep the earlier option", () => {
    const r = evaluateRule(
      freeShip({ appliesTo: "CHEAPEST" }),
      cartOf(20000, oneGroup(["express", 1500], ["standard", 500], ["economy", 500])),
      RATE1,
    );
    expect(r.shipping).toEqual([{ handle: "standard", amountMinor: 500, percent: 100 }]);
  });
  it("applies independently per delivery group", () => {
    const groups: DeliveryGroup[] = [
      { options: [{ handle: "g1-std", costMinor: 400 }, { handle: "g1-exp", costMinor: 900 }] },
      { options: [{ handle: "g2-std", costMinor: 600 }, { handle: "g2-exp", costMinor: 1200 }] },
    ];
    const all = evaluateRule(freeShip({ appliesTo: "ALL", percent: 100 }), cartOf(20000, groups), RATE1);
    expect(all.shipping.map((s) => s.handle)).toEqual(["g1-std", "g1-exp", "g2-std", "g2-exp"]);
    expect(all.totalMinor).toBe(3100);

    const cheap = evaluateRule(freeShip({ appliesTo: "CHEAPEST", percent: 100 }), cartOf(20000, groups), RATE1);
    expect(cheap.shipping).toEqual([
      { handle: "g1-std", amountMinor: 400, percent: 100 },
      { handle: "g2-std", amountMinor: 600, percent: 100 },
    ]);
  });
});

describe("free shipping: currencies", () => {
  it("JPY cart (exponent 0): USD threshold converted at 150", () => {
    const rule = freeShip({ thresholdMinor: 10000, percent: 100 }); // $100
    const groups = oneGroup(["std", 750]); // ¥750
    expect(evaluateRule(rule, cartOf(14999, groups, "JPY"), { presentmentCurrencyRate: "150" }).shipping).toEqual([]);
    expect(evaluateRule(rule, cartOf(15000, groups, "JPY"), { presentmentCurrencyRate: "150" }).shipping).toEqual([
      { handle: "std", amountMinor: 750, percent: 100 },
    ]);
  });
  it("KWD cart (exponent 3): threshold conversion; percentage rate-free", () => {
    // $100 at 0.307 = 30.700 KWD = 30700 fils
    const rule = freeShip({ thresholdMinor: 10000, percent: 50 });
    const groups = oneGroup(["std", 2000]);
    expect(evaluateRule(rule, cartOf(30699, groups, "KWD"), { presentmentCurrencyRate: "0.307" }).shipping).toEqual([]);
    expect(evaluateRule(rule, cartOf(30700, groups, "KWD"), { presentmentCurrencyRate: "0.307" }).shipping).toEqual([
      { handle: "std", amountMinor: 1000, percent: 50 },
    ]);
  });
  it("max amount converts with the presentment rate", () => {
    const rule = freeShip({ thresholdMinor: 100, percent: 100, maxAmountMinor: 500, currencyCode: "USD" }); // max $5
    const ok = evaluateRule(rule, cartOf(20000, oneGroup(["std", 2000]), "JPY"), { presentmentCurrencyRate: "150" });
    // $5 × 150 = ¥750
    expect(ok.shipping).toEqual([{ handle: "std", amountMinor: 750, percent: null }]);
  });
});

describe("free shipping: no cart-line cap", () => {
  it("still applies with a huge line cart (lines are ignored)", () => {
    const cart = hugeCart(Math.max(...Object.values(MAX_CART_LINES_BY_TYPE)) + 200, 1, 1000);
    cart.subtotalMinor = 50_000;
    cart.deliveryGroups = oneGroup(["std", 999]);
    const r = evaluateRule(freeShip(), cart, RATE1);
    expect(r.shipping).toEqual([{ handle: "std", amountMinor: 999, percent: 100 }]);
  });
});

describe("free shipping: properties", () => {
  const ruleArb = fc.record({
    thresholdMinor: fc.integer({ min: 1, max: 1_000_000 }),
    percent: fc.integer({ min: 1, max: 10000 }).map((bp) => bp / 100),
    maxAmountMinor: fc.option(fc.integer({ min: 1, max: 500_000 }), { nil: null }),
    appliesTo: fc.constantFrom("ALL", "CHEAPEST") as fc.Arbitrary<FreeShippingAppliesTo>,
  });
  const groupArb = fc.array(
    fc.array(
      fc.record({
        handle: fc.string({ minLength: 1, maxLength: 12 }),
        costMinor: fc.integer({ min: 0, max: 50_000 }),
      }),
      { minLength: 1, maxLength: 5 },
    ).map((options) => ({ options })),
    { minLength: 0, maxLength: 3 },
  );

  it("never negative, never above option cost, deterministic", () => {
    fc.assert(
      fc.property(ruleArb, fc.integer({ min: 0, max: 2_000_000 }), groupArb, fc.constantFrom("1.0", "150", "0.307"), (cfg, subtotal, groups, rate) => {
        const rule = freeShip(cfg);
        const cart = cartOf(subtotal, groups);
        const a = evaluateRule(rule, cart, { presentmentCurrencyRate: rate });
        const b = evaluateRule(rule, cart, { presentmentCurrencyRate: rate });
        expect(a).toEqual(b);
        expect(a.totalMinor).toBeGreaterThanOrEqual(0);
        expect(a.discountClass).toBe("SHIPPING");
        let sum = 0;
        for (const s of a.shipping) {
          expect(s.amountMinor).toBeGreaterThan(0);
          expect(Number.isSafeInteger(s.amountMinor)).toBe(true);
          const cost = groups.flatMap((g) => g.options).find((o) => o.handle === s.handle)?.costMinor ?? 0;
          expect(s.amountMinor).toBeLessThanOrEqual(cost);
          sum += s.amountMinor;
        }
        expect(a.totalMinor).toBe(sum);
      }),
    );
  });
});
