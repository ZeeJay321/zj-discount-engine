// Builders for Shopify Function fixtures (shared by the fixture generator and the
// perf script). Fixtures are plain JSON in Shopify's function-runner format, so they
// can be reused unchanged by a future Rust implementation of the Function.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const C100 = "gid://shopify/Collection/100";

export const MAX_CART_LINES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "discount-core", "src", "limits.json"), "utf8"),
).maxCartLines;

/** Amount-off-collection rule metafield (current schema v2). */
export function metafield({ ruleId = "rule_1", title = "10% off Winter", collectionIds = [C100], value }) {
  return {
    jsonValue: {
      schemaVersion: 2,
      ruleId,
      title,
      collectionIds,
      includeLines: true,
      config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds }, value },
    },
  };
}

/** Same rule as written before tiered spend existed (schema v1, no includeLines). */
export function metafieldV1({ ruleId = "rule_1", title = "10% off Winter", collectionIds = [C100], value }) {
  return {
    jsonValue: {
      schemaVersion: 1,
      ruleId,
      title,
      collectionIds,
      config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds }, value },
    },
  };
}

/** Tiered-spend rule metafield: tiers = [[thresholdMinor, value], ...] in shop currency. */
export function tieredMetafield({ ruleId = "tiered_1", title = "Spend more, save more", currencyCode = "USD", tiers }) {
  return {
    jsonValue: {
      schemaVersion: 2,
      ruleId,
      title,
      collectionIds: [],
      includeLines: false,
      config: {
        type: "TIERED_SPEND",
        currencyCode,
        tiers: tiers.map(([thresholdMinor, value]) => ({ thresholdMinor, value })),
      },
    },
  };
}

export function line(n, { quantity = 1, amount, inCollection = true } = {}) {
  return {
    id: `gid://shopify/CartLine/${n}`,
    quantity,
    cost: { subtotalAmount: { amount } },
    merchandise: { product: { inAnyCollection: inCollection } },
  };
}

/** A non-product line (e.g. a custom item): the ProductVariant fragment yields {}. */
export function customLine(n, amount) {
  return { id: `gid://shopify/CartLine/${n}`, quantity: 1, cost: { subtotalAmount: { amount } }, merchandise: {} };
}

/** Cart-lines input. `subtotal` defaults to the sum of the line amounts. */
export function linesInput({ lines, metafield: mf, discountClasses = ["PRODUCT"], rate = "1.0", currencyCode = "USD", subtotal }) {
  const sum = lines.reduce((a, l) => a + Number(l.cost.subtotalAmount.amount), 0);
  const amount = subtotal ?? (currencyCode === "JPY" ? String(Math.round(sum)) : sum.toFixed(2));
  return {
    presentmentCurrencyRate: rate,
    cart: { cost: { subtotalAmount: { amount, currencyCode } }, lines },
    discount: { discountClasses, metafield: mf ?? null },
  };
}

/** Order-rule input as Shopify sends it when includeLines=false: no lines at all. */
export function orderInput({ subtotal, metafield: mf, discountClasses = ["ORDER"], rate = "1.0", currencyCode = "USD" }) {
  return {
    presentmentCurrencyRate: rate,
    cart: { cost: { subtotalAmount: { amount: subtotal, currencyCode } } },
    discount: { discountClasses, metafield: mf ?? null },
  };
}

export function fixture(input, output) {
  return {
    payload: {
      export: "cart-lines-discounts-generate-run",
      target: "cart.lines.discounts.generate.run",
      input,
      output,
    },
  };
}

/** N lines of `unit` × quantity. `eligible(i)` decides collection membership (default: all). */
export function bigCart(lineCount, quantity = 1, unit = "99.99", eligible = () => true) {
  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(line(i, { quantity, amount: (Number(unit) * quantity).toFixed(2), inCollection: eligible(i) }));
  }
  return lines;
}

export const pct = (percent) => ({ kind: "PERCENTAGE", percent });
export const fixedOnce = (amountMinor, currencyCode = "USD") => ({ kind: "FIXED_AMOUNT", amountMinor, currencyCode, appliesToEachItem: false });
export const fixedEach = (amountMinor, currencyCode = "USD") => ({ kind: "FIXED_AMOUNT", amountMinor, currencyCode, appliesToEachItem: true });
export const tierPct = (percent) => ({ kind: "PERCENTAGE", percent });
export const tierFixed = (amountMinor) => ({ kind: "FIXED_AMOUNT", amountMinor });
