/**
 * Function drift guard: one fixture per rule type. Build Cart the same way as
 * extensions/zj-discount-function/src/adapter.ts, then assert simulate totals match
 * the fixture's expected discount amounts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  currencyExponent,
  decimalToMinor,
  parseMetafieldPayload,
  simulate,
  targetOf,
  type BundleComponent,
  type Cart,
  type CartLine,
  type DeliveryGroup,
  type ProductTarget,
  type SimulatableRule,
} from "../src";

const FIXTURES = join(__dirname, "../../../extensions/zj-discount-function/tests/fixtures");
const NOW = new Date("2026-06-15T12:00:00Z");
const COMBINES = { orderDiscounts: true, productDiscounts: true, shippingDiscounts: false };

type FixtureFile = {
  payload: {
    input: {
      presentmentCurrencyRate: string | number;
      cart: {
        cost: { subtotalAmount: { amount: string | number; currencyCode: string } };
        lines?: ReadonlyArray<{
          id: string;
          quantity: number;
          cost: { amountPerQuantity: { amount: string | number } };
          merchandise: { id?: string; product?: { id: string; inAnyCollection: boolean } };
        }>;
        deliveryGroups?: ReadonlyArray<{
          deliveryOptions: ReadonlyArray<{ handle: string; cost: { amount: string | number } }>;
        }>;
      };
      discount: { metafield: { jsonValue: unknown } };
    };
    output: { operations: unknown[] };
  };
};

function loadFixture(name: string): FixtureFile {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as FixtureFile;
}

type LineFilter = (variantId: string, productId: string, inAnyCollection: boolean) => boolean;

function targetFilter(target: ProductTarget): LineFilter {
  if (target.kind === "PRODUCTS") {
    const ids = target.productIds;
    return (_v, productId) => ids.includes(productId);
  }
  return (_v, _p, inAnyCollection) => inAnyCollection;
}

function bundleFilter(components: readonly BundleComponent[]): LineFilter {
  const variants: string[] = [];
  const products: string[] = [];
  for (const c of components) (c.kind === "VARIANT" ? variants : products).push(c.kind === "VARIANT" ? c.variantId : c.productId);
  return (variantId, productId) => variants.includes(variantId) || products.includes(productId);
}

/** Mirrors adapter.toCoreCart */
function toCoreCart(
  input: FixtureFile["payload"]["input"],
  keep: LineFilter,
  collectionIds: readonly string[],
): Cart {
  const currencyCode = input.cart.cost.subtotalAmount.currencyCode;
  const exp = currencyExponent(currencyCode);
  const lines: CartLine[] = [];
  for (const line of input.cart.lines ?? []) {
    const m = line.merchandise;
    const product = m.product;
    if (product === undefined) continue;
    const variantId = m.id ?? "";
    if (!keep(variantId, product.id, product.inAnyCollection)) continue;
    let unitPriceMinor: number;
    try {
      unitPriceMinor = decimalToMinor(line.cost.amountPerQuantity.amount, exp);
    } catch {
      continue;
    }
    lines.push({
      id: line.id,
      quantity: line.quantity,
      unitPriceMinor,
      subtotalMinor: unitPriceMinor * line.quantity,
      productId: product.id,
      variantId,
      collectionIds: [...collectionIds],
    });
  }
  return { currencyCode, lines };
}

/** Mirrors adapter.toCoreOrderCart */
function toCoreOrderCart(input: FixtureFile["payload"]["input"]): Cart {
  const { amount, currencyCode } = input.cart.cost.subtotalAmount;
  let subtotalMinor = 0;
  try {
    subtotalMinor = decimalToMinor(amount, currencyExponent(currencyCode));
  } catch {
    subtotalMinor = 0;
  }
  return { currencyCode, lines: [], subtotalMinor };
}

/** Mirrors adapter.toCoreDeliveryCart */
function toCoreDeliveryCart(input: FixtureFile["payload"]["input"]): Cart {
  const { amount, currencyCode } = input.cart.cost.subtotalAmount;
  const exp = currencyExponent(currencyCode);
  let subtotalMinor = 0;
  try {
    subtotalMinor = decimalToMinor(amount, exp);
  } catch {
    subtotalMinor = 0;
  }
  const deliveryGroups: DeliveryGroup[] = [];
  for (const g of input.cart.deliveryGroups ?? []) {
    const options = [];
    for (const o of g.deliveryOptions ?? []) {
      try {
        options.push({ handle: o.handle, costMinor: decimalToMinor(o.cost.amount, exp) });
      } catch {
        /* skip */
      }
    }
    deliveryGroups.push({ options });
  }
  return { currencyCode, lines: [], subtotalMinor, deliveryGroups };
}

/** Sum fixed-amount candidates from fixture output (product or delivery). */
function expectedTotalMinorFromOutput(output: { operations: unknown[] }, currencyCode: string): number {
  const exp = currencyExponent(currencyCode);
  let total = 0;
  for (const op of output.operations) {
    const o = op as Record<string, unknown>;
    const product = o.productDiscountsAdd as { candidates?: Array<{ value: { fixedAmount?: { amount: number }; percentage?: { value: number } } }> } | undefined;
    if (product?.candidates) {
      for (const c of product.candidates) {
        if (c.value.fixedAmount) total += decimalToMinor(c.value.fixedAmount.amount, exp);
      }
    }
    const order = o.orderDiscountsAdd as {
      candidates?: Array<{ value: { fixedAmount?: { amount: number }; percentage?: { value: number } }; targets?: Array<{ orderSubtotal?: unknown }> }>;
    } | undefined;
    if (order?.candidates) {
      for (const c of order.candidates) {
        if (c.value.fixedAmount) total += decimalToMinor(c.value.fixedAmount.amount, exp);
        else if (c.value.percentage) {
          // Percentage of cart subtotal — caller passes subtotal via side channel below
          return -1; // signal: use percentage * subtotal
        }
      }
    }
    const delivery = o.deliveryDiscountsAdd as {
      candidates?: Array<{
        targets: Array<{ deliveryOption: { handle: string } }>;
        value: { fixedAmount?: { amount: number }; percentage?: { value: number } };
      }>;
    } | undefined;
    if (delivery?.candidates) {
      for (const c of delivery.candidates) {
        if (c.value.fixedAmount) total += decimalToMinor(c.value.fixedAmount.amount, exp);
        else if (c.value.percentage) return -2; // percentage shipping — use simulate's own total vs known costs
      }
    }
  }
  return total;
}

function toSimRule(payload: { ruleId: string; title: string; config: SimulatableRule["config"] }): SimulatableRule {
  return {
    ruleId: payload.ruleId,
    title: payload.title,
    config: payload.config,
    enabled: true,
    startsAt: "2020-01-01T00:00:00Z",
    endsAt: null,
    combinesWith: COMBINES,
  };
}

describe("simulate ⇄ Function fixture totals (one per rule type)", () => {
  it("AMOUNT_OFF_PRODUCTS: lines-percent-collection", () => {
    const fx = loadFixture("lines-percent-collection.json");
    const parsed = parseMetafieldPayload(fx.payload.input.discount.metafield.jsonValue);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const target = targetOf(parsed.value.config);
    expect(target).not.toBeNull();
    const cart = toCoreCart(fx.payload.input, targetFilter(target!), parsed.value.collectionIds);
    const out = simulate([toSimRule(parsed.value)], cart, NOW, {
      presentmentCurrencyRate: fx.payload.input.presentmentCurrencyRate,
    });
    expect(out.perRule[0].result.totalMinor).toBe(
      expectedTotalMinorFromOutput(fx.payload.output, cart.currencyCode),
    );
    expect(out.perRule[0].result.totalMinor).toBe(300);
  });

  it("TIERED_SPEND: tiered-at-second", () => {
    const fx = loadFixture("tiered-at-second.json");
    const parsed = parseMetafieldPayload(fx.payload.input.discount.metafield.jsonValue);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cart = toCoreOrderCart(fx.payload.input);
    const out = simulate([toSimRule(parsed.value)], cart, NOW, {
      presentmentCurrencyRate: fx.payload.input.presentmentCurrencyRate,
    });
    // 15% of $200.00
    expect(out.perRule[0].result.totalMinor).toBe(3000);
    expect(out.perRule[0].result.order?.percent).toBe(15);
  });

  it("BUY_X_GET_Y: bogo-3-units", () => {
    const fx = loadFixture("bogo-3-units.json");
    const parsed = parseMetafieldPayload(fx.payload.input.discount.metafield.jsonValue);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const target = targetOf(parsed.value.config);
    const cart = toCoreCart(fx.payload.input, targetFilter(target!), parsed.value.collectionIds);
    const out = simulate([toSimRule(parsed.value)], cart, NOW, {
      presentmentCurrencyRate: fx.payload.input.presentmentCurrencyRate,
    });
    expect(out.perRule[0].result.totalMinor).toBe(
      expectedTotalMinorFromOutput(fx.payload.output, cart.currencyCode),
    );
    expect(out.perRule[0].result.totalMinor).toBe(1000);
  });

  it("BUNDLE: bundle-one", () => {
    const fx = loadFixture("bundle-one.json");
    const parsed = parseMetafieldPayload(fx.payload.input.discount.metafield.jsonValue);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cfg = parsed.value.config;
    expect(cfg.type).toBe("BUNDLE");
    if (cfg.type !== "BUNDLE") return;
    const cart = toCoreCart(fx.payload.input, bundleFilter(cfg.components), parsed.value.collectionIds);
    const out = simulate([toSimRule(parsed.value)], cart, NOW, {
      presentmentCurrencyRate: fx.payload.input.presentmentCurrencyRate,
    });
    expect(out.perRule[0].result.totalMinor).toBe(
      expectedTotalMinorFromOutput(fx.payload.output, cart.currencyCode),
    );
    expect(out.perRule[0].result.totalMinor).toBe(1600);
  });

  it("FREE_SHIPPING: ship-at-threshold", () => {
    const fx = loadFixture("ship-at-threshold.json");
    const parsed = parseMetafieldPayload(fx.payload.input.discount.metafield.jsonValue);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cart = toCoreDeliveryCart(fx.payload.input);
    const out = simulate([toSimRule(parsed.value)], cart, NOW, {
      presentmentCurrencyRate: fx.payload.input.presentmentCurrencyRate,
    });
    // 100% of $5 + $15
    expect(out.perRule[0].result.totalMinor).toBe(2000);
    expect(out.perRule[0].result.shipping).toHaveLength(2);
  });
});
