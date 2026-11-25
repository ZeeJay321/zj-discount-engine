import { describe, expect, it } from "vitest";
import { evaluateRule, MAX_CART_LINES_BY_TYPE, MAX_LINE_SUBTOTAL_MINOR } from "../src";
import { C100, C200, fixed, hugeCart, loadCart, pct, rule } from "./helpers";

const MAX_CART_LINES = MAX_CART_LINES_BY_TYPE.AMOUNT_OFF_PRODUCTS;

const RATE1 = { presentmentCurrencyRate: "1.0" };
const amounts = (r: ReturnType<typeof evaluateRule>) => r.lines.map((l) => [l.lineId.split("/").pop(), l.amountMinor]);

describe("amount off products — percentage", () => {
  it("discounts only lines in the rule's collections", () => {
    const r = evaluateRule(rule(pct(10)), loadCart("mixed-usd"), RATE1);
    expect(amounts(r)).toEqual([["1", 200], ["2", 100]]);
    expect(r.totalMinor).toBe(300);
    expect(r.discountClass).toBe("PRODUCT");
    expect(r.message).toBe("Test rule");
    expect(r.currencyCode).toBe("USD");
  });

  it("matches any of several collections, without double counting a line in both", () => {
    const r = evaluateRule(rule(pct(10), [C200, C100]), loadCart("mixed-usd"), RATE1);
    expect(r.totalMinor).toBe(300);
    expect(r.lines).toHaveLength(2);
  });

  it("returns nothing when no line is in the collection", () => {
    const r = evaluateRule(rule(pct(10), ["gid://shopify/Collection/999"]), loadCart("mixed-usd"), RATE1);
    expect(r.lines).toEqual([]);
    expect(r.totalMinor).toBe(0);
  });

  it("returns nothing for an empty cart", () => {
    expect(evaluateRule(rule(pct(50)), loadCart("empty"), RATE1).lines).toEqual([]);
  });

  it("skips zero-quantity and zero-subtotal lines", () => {
    const r = evaluateRule(rule(pct(10)), loadCart("zero-quantity"), RATE1);
    expect(amounts(r)).toEqual([["2", 100]]);
  });

  it("rounds the total once (10% of 3.33+3.33+3.34 = 1.00, not 0.99)", () => {
    const r = evaluateRule(rule(pct(10)), loadCart("odd-cents"), RATE1);
    expect(amounts(r)).toEqual([["1", 33], ["2", 33], ["3", 34]]);
    expect(r.totalMinor).toBe(100);
  });

  it("splits half cents deterministically (50%)", () => {
    const r = evaluateRule(rule(pct(50)), loadCart("odd-cents"), RATE1);
    expect(amounts(r)).toEqual([["1", 167], ["2", 166], ["3", 167]]);
    expect(r.totalMinor).toBe(500);
  });

  it("supports two-decimal percentages (12.5%)", () => {
    const r = evaluateRule(rule(pct(12.5)), loadCart("odd-cents"), RATE1);
    expect(r.totalMinor).toBe(125);
  });

  it("100% makes eligible lines free and never more", () => {
    const r = evaluateRule(rule(pct(100)), loadCart("mixed-usd"), RATE1);
    expect(amounts(r)).toEqual([["1", 2000], ["2", 999]]);
  });

  it("clamps out-of-range percentages defensively (validation rejects them first)", () => {
    expect(evaluateRule(rule(pct(150)), loadCart("mixed-usd"), RATE1).totalMinor).toBe(2999);
    expect(evaluateRule(rule(pct(-5)), loadCart("mixed-usd"), RATE1).totalMinor).toBe(0);
  });

  it("works in a zero-decimal currency (JPY)", () => {
    const r = evaluateRule(rule(pct(15)), loadCart("jpy"), RATE1);
    expect(amounts(r)).toEqual([["1", 300], ["2", 450]]);
    expect(r.totalMinor).toBe(750);
    expect(r.currencyCode).toBe("JPY");
  });

  it("works in a three-decimal currency (KWD)", () => {
    expect(evaluateRule(rule(pct(10)), loadCart("kwd"), RATE1).totalMinor).toBe(1235);
  });

  it("is unaffected by presentment rate (percentages are currency-free)", () => {
    const a = evaluateRule(rule(pct(15)), loadCart("jpy"), RATE1);
    const b = evaluateRule(rule(pct(15)), loadCart("jpy"), { presentmentCurrencyRate: "150" });
    expect(b).toEqual(a);
  });
});

describe("amount off products — fixed amount", () => {
  it("per item: amount × quantity per line", () => {
    const r = evaluateRule(rule(fixed(500, true)), loadCart("mixed-usd"), RATE1);
    expect(amounts(r)).toEqual([["1", 1000], ["2", 500]]);
  });

  it("per item: clamps to the line subtotal", () => {
    const r = evaluateRule(rule(fixed(1500, true)), loadCart("mixed-usd"), RATE1);
    expect(amounts(r)).toEqual([["1", 2000], ["2", 999]]);
  });

  it("once per order: splits across eligible lines and sums exactly", () => {
    const r = evaluateRule(rule(fixed(500, false)), loadCart("odd-cents"), RATE1);
    expect(amounts(r)).toEqual([["1", 167], ["2", 166], ["3", 167]]);
    expect(r.totalMinor).toBe(500);
  });

  it("once per order: clamps to the eligible subtotal", () => {
    const r = evaluateRule(rule(fixed(5000, false)), loadCart("mixed-usd"), RATE1);
    expect(amounts(r)).toEqual([["1", 2000], ["2", 999]]);
  });

  it("converts shop currency to cart currency (USD → JPY at 150)", () => {
    const r = evaluateRule(rule(fixed(500, true, "USD")), loadCart("jpy"), { presentmentCurrencyRate: "150.0" });
    expect(amounts(r)).toEqual([["1", 750], ["2", 1500]]);
  });

  it("converts shop currency to cart currency (USD → KWD at 0.307)", () => {
    const r = evaluateRule(rule(fixed(100, false, "USD")), loadCart("kwd"), { presentmentCurrencyRate: 0.307 });
    expect(r.totalMinor).toBe(307);
  });

  it("returns nothing for an empty cart", () => {
    expect(evaluateRule(rule(fixed(500, false)), loadCart("empty"), RATE1).totalMinor).toBe(0);
  });
});

describe("huge carts and the line cap", () => {
  it(`at the cap (${MAX_CART_LINES} lines × 999 qty): total equals the exact rounded percentage`, () => {
    const cart = hugeCart(MAX_CART_LINES);
    const r = evaluateRule(rule(pct(25)), cart, RATE1);
    const eligible = cart.lines.filter((l) => l.collectionIds.length > 0);
    const exact = eligible.reduce((a, l) => a + BigInt(l.subtotalMinor) * 2500n, 0n);
    expect(r.lines).toHaveLength(eligible.length);
    expect(BigInt(r.totalMinor)).toBe((exact + 5000n) / 10000n);
    expect(Number.isSafeInteger(r.totalMinor)).toBe(true);
  });

  it("at the cap: fixed once-per-order splits exactly", () => {
    const r = evaluateRule(rule(fixed(1_000_001, false)), hugeCart(MAX_CART_LINES), RATE1);
    expect(r.totalMinor).toBe(1_000_001);
  });

  it("one line above the cap: no discount at all, never partial", () => {
    const r = evaluateRule(rule(pct(25)), hugeCart(MAX_CART_LINES + 1), RATE1);
    expect(r.lines).toEqual([]);
    expect(r.totalMinor).toBe(0);
    expect(r.discountClass).toBe("PRODUCT");
  });

  it("250 lines × 999 qty (far above the cap): no discount", () => {
    expect(evaluateRule(rule(fixed(500, true)), hugeCart(250), RATE1).totalMinor).toBe(0);
  });

  it("the cap counts every cart line, eligible or not", () => {
    const cart = hugeCart(MAX_CART_LINES + 1);
    const allIneligibleButOne = { ...cart, lines: cart.lines.map((l, i) => ({ ...l, collectionIds: i === 0 ? l.collectionIds : [] })) };
    expect(evaluateRule(rule(pct(10)), allIneligibleButOne, RATE1).totalMinor).toBe(0);
  });

  it("caps are positive integers read from limits.json, and tiered spend has none", async () => {
    const { MAX_CART_LINES_BY_TYPE: caps, maxCartLinesFor } = await import("../src");
    for (const v of Object.values(caps)) expect(Number.isInteger(v) && v > 0).toBe(true);
    expect(maxCartLinesFor("TIERED_SPEND")).toBeNull();
    expect(maxCartLinesFor("FREE_SHIPPING")).toBeNull();
    expect(maxCartLinesFor("BUNDLE")).toBe(caps.BUNDLE);
  });

  it("ignores lines whose subtotal would overflow integer maths", () => {
    const cart = {
      currencyCode: "USD",
      lines: [
        { id: "a", quantity: 1, subtotalMinor: MAX_LINE_SUBTOTAL_MINOR + 1, productId: "p", variantId: null, collectionIds: [C100] },
        { id: "b", quantity: 1, subtotalMinor: 1000, productId: "p", variantId: null, collectionIds: [C100] },
      ],
    };
    const r = evaluateRule(rule(pct(10)), cart, RATE1);
    expect(r.lines).toEqual([{ lineId: "b", amountMinor: 100 }]);
  });

  it("ignores lines with non-integer quantity or non-integer subtotal", () => {
    const cart = {
      currencyCode: "USD",
      lines: [
        { id: "a", quantity: 1.5, subtotalMinor: 1000, productId: "p", variantId: null, collectionIds: [C100] },
        { id: "b", quantity: 1, subtotalMinor: 10.5, productId: "p", variantId: null, collectionIds: [C100] },
      ],
    };
    expect(evaluateRule(rule(pct(10)), cart, RATE1).lines).toEqual([]);
  });
});

describe("determinism", () => {
  it("same input → identical output", () => {
    const cart = hugeCart(MAX_CART_LINES, 3, 1999);
    expect(evaluateRule(rule(pct(33.33)), cart, RATE1)).toEqual(evaluateRule(rule(pct(33.33)), cart, RATE1));
  });
});
