import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  evaluateRule,
  MAX_CART_LINES_BY_TYPE,
  simulate,
  TIER_BASIS,
  type Cart,
  type CombinesWith,
  type EvaluableRule,
  type SimulatableRule,
  type TierValue,
} from "../src";
import { C100, fixed, hugeCart, loadCart, pct, rule } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00Z");
const COMBINE_ALL: CombinesWith = { orderDiscounts: true, productDiscounts: true, shippingDiscounts: false };
const COMBINE_NONE: CombinesWith = { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false };

function sim(
  base: EvaluableRule,
  overrides: Partial<SimulatableRule> = {},
): SimulatableRule {
  return {
    ...base,
    enabled: true,
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: null,
    combinesWith: COMBINE_ALL,
    ...overrides,
  };
}

function tiered(tiers: Array<[number, TierValue]>): EvaluableRule {
  return {
    ruleId: "tiered_1",
    title: "Spend tiers",
    config: {
      type: "TIERED_SPEND",
      currencyCode: "USD",
      tiers: tiers.map(([thresholdMinor, value]) => ({ thresholdMinor, value })),
    },
  };
}

function freeShip(thresholdMinor = 10000): EvaluableRule {
  return {
    ruleId: "ship_1",
    title: "Free ship",
    config: {
      type: "FREE_SHIPPING",
      currencyCode: "USD",
      thresholdMinor,
      percent: 100,
      maxAmountMinor: null,
      appliesTo: "ALL",
    },
  };
}

const P = (percent: number): TierValue => ({ kind: "PERCENTAGE", percent });

describe("simulate: per-rule result equals evaluateRule", () => {
  const cases: Array<[string, EvaluableRule, Cart]> = [
    ["amount-off mixed", rule(pct(10)), loadCart("mixed-usd")],
    ["amount-off fixed", rule(fixed(500, true)), loadCart("mixed-usd")],
    [
      "tiered",
      tiered([
        [10000, P(10)],
        [20000, P(15)],
      ]),
      { currencyCode: "USD", lines: [], subtotalMinor: 20000 },
    ],
    [
      "free shipping",
      freeShip(),
      {
        currencyCode: "USD",
        lines: [],
        subtotalMinor: 15000,
        deliveryGroups: [{ options: [{ handle: "std", costMinor: 500 }] }],
      },
    ],
  ];

  it.each(cases)("%s", (_name, base, cart) => {
    const r = sim(base);
    const expected = evaluateRule(r, cart, { presentmentCurrencyRate: 1 });
    const out = simulate([r], cart, NOW);
    expect(out.perRule).toHaveLength(1);
    expect(out.perRule[0].result).toEqual(expected);
    if (expected.totalMinor > 0) {
      expect(out.perRule[0].reason).toBeNull();
      expect(out.perRule[0].includedInEstimate).toBe(true);
    }
  });
});

describe("simulate: dates", () => {
  const cart = loadCart("mixed-usd");
  const base = rule(pct(10));

  it("before start → outside_dates, empty result", () => {
    const r = sim(base, { startsAt: "2026-12-01T00:00:00Z" });
    const out = simulate([r], cart, NOW);
    expect(out.perRule[0].reason).toBe("outside_dates");
    expect(out.perRule[0].result.totalMinor).toBe(0);
    expect(out.combinedTotalMinor).toBe(0);
  });

  it("at/after end → outside_dates", () => {
    const r = sim(base, { endsAt: "2026-06-15T12:00:00Z" });
    const out = simulate([r], cart, NOW);
    expect(out.perRule[0].reason).toBe("outside_dates");
  });

  it("disabled → outside_dates path via isActiveAt", () => {
    const r = sim(base, { enabled: false });
    expect(simulate([r], cart, NOW).perRule[0].reason).toBe("outside_dates");
  });
});

describe("simulate: above-line-cap", () => {
  it("amount-off above cap reports cap number", () => {
    const cap = MAX_CART_LINES_BY_TYPE.AMOUNT_OFF_PRODUCTS;
    const cart = hugeCart(cap + 1);
    const out = simulate([sim(rule(pct(10)))], cart, NOW);
    expect(out.perRule[0].reason).toBe("above_line_cap");
    expect(out.perRule[0].reasonDetail).toContain(String(cap));
    expect(out.perRule[0].result.totalMinor).toBe(0);
  });

  it("buy X get Y uses its own cap", () => {
    const cap = MAX_CART_LINES_BY_TYPE.BUY_X_GET_Y;
    const base: EvaluableRule = {
      ruleId: "bogo_1",
      title: "BOGO",
      config: {
        type: "BUY_X_GET_Y",
        target: { kind: "COLLECTIONS", collectionIds: [C100] },
        buyQuantity: 2,
        getQuantity: 1,
        percent: 100,
        limitPerOrder: 3,
      },
    };
    const out = simulate([sim(base)], hugeCart(cap + 1), NOW);
    expect(out.perRule[0].reason).toBe("above_line_cap");
    expect(out.perRule[0].reasonDetail).toContain(String(cap));
  });
});

describe("simulate: empty / no-discount reasons", () => {
  it("empty cart", () => {
    const out = simulate([sim(rule(pct(10)))], { currencyCode: "USD", lines: [] }, NOW);
    expect(out.perRule[0].reason).toBe("empty_cart");
  });

  it("free shipping below threshold", () => {
    const cart: Cart = {
      currencyCode: "USD",
      lines: [],
      subtotalMinor: 5000,
      deliveryGroups: [{ options: [{ handle: "std", costMinor: 500 }] }],
    };
    expect(simulate([sim(freeShip())], cart, NOW).perRule[0].reason).toBe("below_threshold");
  });

  it("free shipping with no options", () => {
    const cart: Cart = { currencyCode: "USD", lines: [], subtotalMinor: 20000, deliveryGroups: [] };
    expect(simulate([sim(freeShip())], cart, NOW).perRule[0].reason).toBe("no_delivery_options");
  });

  it("no matching lines", () => {
    const out = simulate(
      [sim(rule(pct(10), ["gid://shopify/Collection/999"]))],
      loadCart("mixed-usd"),
      NOW,
    );
    expect(out.perRule[0].reason).toBe("no_matching_lines");
  });
});

describe("simulate: combination estimate", () => {
  const cart = loadCart("mixed-usd"); // eligible ~300 off at 10%, 600 at 20%
  const a = sim(rule(pct(10), [C100], "10%"), { ruleId: "a", combinesWith: COMBINE_ALL });
  const b = sim(rule(pct(20), [C100], "20%"), { ruleId: "b", combinesWith: COMBINE_ALL });

  it("both combine on product → sum", () => {
    const out = simulate([a, b], cart, NOW);
    expect(out.productTotalMinor).toBe(out.perRule[0].result.totalMinor + out.perRule[1].result.totalMinor);
    expect(out.combinedTotalMinor).toBe(out.productTotalMinor);
    expect(out.estimateRuleIds.sort()).toEqual(["a", "b"]);
  });

  it("neither combines → max wins", () => {
    const a0 = { ...a, combinesWith: COMBINE_NONE };
    const b0 = { ...b, combinesWith: COMBINE_NONE };
    const out = simulate([a0, b0], cart, NOW);
    const totals = out.perRule.map((p) => p.result.totalMinor);
    expect(out.productTotalMinor).toBe(Math.max(...totals));
    expect(out.estimateRuleIds).toHaveLength(1);
  });

  it("shipping stays separate from product/order", () => {
    const ship = sim(freeShip(), {
      ruleId: "ship",
      combinesWith: { ...COMBINE_NONE, shippingDiscounts: false },
    });
    const deliveryCart: Cart = {
      currencyCode: "USD",
      lines: cart.lines,
      subtotalMinor: 15000,
      deliveryGroups: [{ options: [{ handle: "std", costMinor: 700 }] }],
    };
    const out = simulate([a, ship], deliveryCart, NOW);
    expect(out.shippingTotalMinor).toBe(700);
    expect(out.productTotalMinor).toBeGreaterThan(0);
    expect(out.combinedTotalMinor).toBe(out.productTotalMinor + out.shippingTotalMinor);
  });

  it("product before order % with after_product_discounts basis", () => {
    const product = sim(rule(pct(10)), { ruleId: "prod" });
    const order = sim(
      tiered([
        [10000, P(10)],
        [25000, P(20)],
      ]),
      { ruleId: "ord" },
    );
    // mixed-usd eligible lines: 20+9.99 = 2999; full cart subtotal from lines
    const linesCart: Cart = {
      currencyCode: "USD",
      lines: cart.lines,
      subtotalMinor: cart.lines.reduce((s, l) => s + l.subtotalMinor, 0),
    };
    const before = simulate([product, order], linesCart, NOW, { tierBasis: "before_product_discounts" });
    const after = simulate([product, order], linesCart, NOW, { tierBasis: "after_product_discounts" });
    expect(before.productTotalMinor).toBe(after.productTotalMinor);
    // After product discounts, order basis is lower → order total may shrink or stay
    expect(after.orderTotalMinor).toBeLessThanOrEqual(before.orderTotalMinor);
  });
});

describe("simulate: TIER_BASIS default", () => {
  it("exports before_product_discounts", () => {
    expect(TIER_BASIS).toBe("before_product_discounts");
  });

  it("after_product_discounts can drop below a tier threshold", () => {
    const product = sim(
      {
        ruleId: "prod",
        title: "Big product off",
        config: {
          type: "AMOUNT_OFF_PRODUCTS",
          target: { kind: "COLLECTIONS", collectionIds: [C100] },
          value: { kind: "FIXED_AMOUNT", amountMinor: 15000, currencyCode: "USD", appliesToEachItem: false },
        },
      },
      { ruleId: "prod" },
    );
    const order = sim(
      tiered([
        [10000, P(10)],
        [20000, P(15)],
      ]),
      { ruleId: "ord" },
    );
    const cart: Cart = {
      currencyCode: "USD",
      lines: [
        {
          id: "gid://shopify/CartLine/1",
          quantity: 1,
          subtotalMinor: 25000,
          collectionIds: [C100],
        },
      ],
      subtotalMinor: 25000,
    };
    const before = simulate([product, order], cart, NOW, { tierBasis: "before_product_discounts" });
    const after = simulate([product, order], cart, NOW, { tierBasis: "after_product_discounts" });
    expect(before.orderTotalMinor).toBe(3750); // 15% of 25000
    // product takes 15000 → remaining 10000 → 10% = 1000
    expect(after.orderTotalMinor).toBe(1000);
  });
});

describe("simulate: properties", () => {
  const ruleArb = fc.record({
    pct: fc.integer({ min: 1, max: 50 }),
    combine: fc.boolean(),
  });
  const cartArb = fc.record({
    unit: fc.integer({ min: 100, max: 50_000 }),
    qty: fc.integer({ min: 1, max: 5 }),
    ship: fc.integer({ min: 0, max: 5_000 }),
  });

  it("combined ≥ 0, ≤ merchandise + shipping, deterministic", () => {
    fc.assert(
      fc.property(ruleArb, ruleArb, cartArb, (ra, rb, c) => {
        const cart: Cart = {
          currencyCode: "USD",
          lines: [
            {
              id: "gid://shopify/CartLine/1",
              quantity: c.qty,
              subtotalMinor: c.unit * c.qty,
              collectionIds: [C100],
            },
          ],
          subtotalMinor: c.unit * c.qty,
          deliveryGroups: c.ship > 0 ? [{ options: [{ handle: "std", costMinor: c.ship }] }] : [],
        };
        const rules = [
          sim(rule(pct(ra.pct)), {
            ruleId: "a",
            combinesWith: { ...COMBINE_ALL, productDiscounts: ra.combine },
          }),
          sim(rule(pct(rb.pct)), {
            ruleId: "b",
            combinesWith: { ...COMBINE_ALL, productDiscounts: rb.combine },
          }),
          sim(freeShip(1), {
            ruleId: "s",
            combinesWith: COMBINE_NONE,
          }),
        ];
        const once = simulate(rules, cart, NOW);
        const twice = simulate(rules, cart, NOW);
        expect(once).toEqual(twice);
        expect(once.combinedTotalMinor).toBeGreaterThanOrEqual(0);
        const merch = c.unit * c.qty;
        expect(once.combinedTotalMinor).toBeLessThanOrEqual(merch + c.ship);
        expect(once.productTotalMinor + once.orderTotalMinor + once.shippingTotalMinor).toBe(
          once.combinedTotalMinor,
        );
      }),
      { numRuns: 40 },
    );
  });
});
