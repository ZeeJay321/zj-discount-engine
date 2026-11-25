// Builders for Shopify Function fixtures (shared by the fixture generator and the
// perf script). Fixtures are plain JSON in Shopify's function-runner format, so they
// can be reused unchanged by a future Rust implementation of the Function.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const C100 = "gid://shopify/Collection/100";

/** Per-rule-type line caps (same JSON core reads). */
export const CAPS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "discount-core", "src", "limits.json"), "utf8"),
).maxCartLines;
export const MIN_CAP = Math.min(...Object.values(CAPS));

/** Amount-off-collection rule metafield (current schema v2). */
export function metafield({ ruleId = "rule_1", title = "10% off Winter", collectionIds = [C100], value }) {
  return {
    jsonValue: {
      schemaVersion: 3,
      ruleId,
      title,
      collectionIds,
      config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds }, value },
    },
  };
}

/** Same rule as written before tiered spend existed (schema v1). */
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
      config: {
        type: "TIERED_SPEND",
        currencyCode,
        tiers: tiers.map(([thresholdMinor, value]) => ({ thresholdMinor, value })),
      },
    },
  };
}

const decimalsOf = (s) => (String(s).includes(".") ? String(s).split(".")[1].length : 0);

/**
 * A product cart line. Give either `amount` (the line subtotal; the unit price is
 * amount / quantity) or `unit` (the unit price). Product id: gid://shopify/Product/<n>
 * unless `productId` is given.
 */
/** Real-length ids (36-char line UUIDs, 13-digit product ids) for instruction counting. */
const realLineId = (n) => `gid://shopify/CartLine/${String(n).padStart(8, "0")}-4b1d-4c2e-9f3a-${String(n * 7919).padStart(12, "0")}`;
const realProductId = (n) => `gid://shopify/Product/${8_000_000_000_000 + n * 1_000_003}`;
const realVariantId = (n) => `gid://shopify/ProductVariant/${46_000_000_000_000 + n * 1_000_033}`;

export function line(n, { quantity = 1, amount, unit, inCollection = true, productId, variantId, realistic = false } = {}) {
  let unitStr = unit;
  if (unitStr === undefined) {
    const d = decimalsOf(amount);
    const u = Number(amount) / quantity;
    unitStr = d === 0 ? String(u) : u.toFixed(Math.max(d, 2));
  }
  return {
    id: realistic ? realLineId(n) : `gid://shopify/CartLine/${n}`,
    quantity,
    cost: { amountPerQuantity: { amount: unitStr } },
    merchandise: {
      id: variantId ?? (realistic ? realVariantId(n) : `gid://shopify/ProductVariant/${n}`),
      product: { id: productId ?? (realistic ? realProductId(n) : `gid://shopify/Product/${n}`), inAnyCollection: inCollection },
    },
  };
}

/** A non-product line (e.g. a custom item): the ProductVariant fragment yields {}. */
export function customLine(n, amount) {
  return { id: `gid://shopify/CartLine/${n}`, quantity: 1, cost: { amountPerQuantity: { amount } }, merchandise: {} };
}

/** Cart-lines input. `subtotal` defaults to the sum of the line amounts. */
export function linesInput({ lines, metafield: mf, discountClasses = ["PRODUCT"], rate = "1.0", currencyCode = "USD", subtotal }) {
  const sum = lines.reduce((a, l) => a + Number(l.cost.amountPerQuantity.amount) * l.quantity, 0);
  const exp = currencyCode === "JPY" ? 0 : currencyCode === "KWD" ? 3 : 2;
  const amount = subtotal ?? sum.toFixed(exp);
  return {
    presentmentCurrencyRate: rate,
    cart: { cost: { subtotalAmount: { amount, currencyCode } }, lines },
    discount: { discountClasses, metafield: mf ?? null },
  };
}

/**
 * Order-rule input. Shopify always sends lines (directives aren't allowed in input
 * queries); the order path ignores them, so one line carrying the whole subtotal is
 * enough. Pass `lines` to model a bigger cart.
 */
export function orderInput({ subtotal, metafield: mf, discountClasses = ["ORDER"], rate = "1.0", currencyCode = "USD", lines }) {
  return {
    presentmentCurrencyRate: rate,
    cart: {
      cost: { subtotalAmount: { amount: subtotal, currencyCode } },
      lines: lines ?? [line(1, { amount: subtotal, inCollection: false })],
    },
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
export function bigCart(lineCount, quantity = 1, unit = "99.99", eligible = () => true, realistic = false) {
  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(line(i, { quantity, unit, inCollection: eligible(i), realistic }));
  }
  return lines;
}

export const pct = (percent) => ({ kind: "PERCENTAGE", percent });
export const fixedOnce = (amountMinor, currencyCode = "USD") => ({ kind: "FIXED_AMOUNT", amountMinor, currencyCode, appliesToEachItem: false });
export const fixedEach = (amountMinor, currencyCode = "USD") => ({ kind: "FIXED_AMOUNT", amountMinor, currencyCode, appliesToEachItem: true });
export const tierPct = (percent) => ({ kind: "PERCENTAGE", percent });
export const tierFixed = (amountMinor) => ({ kind: "FIXED_AMOUNT", amountMinor });

/** Buy X get Y rule metafield (schema v3). */
export function bogoMetafield({ ruleId = "bogo_1", title = "Buy 2 get 1 free", target = { kind: "COLLECTIONS", collectionIds: [C100] }, buyQuantity = 2, getQuantity = 1, percent = 100, limitPerOrder = 3 } = {}) {
  return {
    jsonValue: {
      schemaVersion: 3,
      ruleId,
      title,
      collectionIds: target.kind === "COLLECTIONS" ? target.collectionIds : [],
      config: { type: "BUY_X_GET_Y", target, buyQuantity, getQuantity, percent, limitPerOrder },
    },
  };
}

/** Bundle rule metafield (schema v4). components: [{ kind, productId, variantId?, quantity }]. */
export function bundleMetafield({
  ruleId = "bundle_1",
  title = "Shirt + Jeans",
  currencyCode = "USD",
  components = [
    { kind: "PRODUCT", productId: "gid://shopify/Product/1", quantity: 1 },
    { kind: "PRODUCT", productId: "gid://shopify/Product/2", quantity: 1 },
  ],
  value = { kind: "PERCENTAGE", percent: 20 },
  limitPerOrder = 3,
} = {}) {
  return {
    jsonValue: { schemaVersion: 4, ruleId, title, collectionIds: [], config: { type: "BUNDLE", currencyCode, components, value, limitPerOrder } },
  };
}

/** Free-shipping rule metafield (schema v5). */
export function freeShippingMetafield({
  ruleId = "ship_1",
  title = "Free shipping over $100",
  currencyCode = "USD",
  thresholdMinor = 10000,
  percent = 100,
  maxAmountMinor = null,
  appliesTo = "ALL",
} = {}) {
  return {
    jsonValue: {
      schemaVersion: 5,
      ruleId,
      title,
      collectionIds: [],
      config: { type: "FREE_SHIPPING", currencyCode, thresholdMinor, percent, maxAmountMinor, appliesTo },
    },
  };
}

/** One delivery option in a group. */
export function deliveryOption(handle, amount) {
  return { handle, cost: { amount } };
}

/**
 * Delivery-options Function input. `groups` is an array of option arrays
 * (each inner array = one delivery group's options).
 */
export function deliveryInput({
  subtotal,
  groups = [[{ handle: "standard", amount: "5.00" }]],
  metafield: mf,
  discountClasses = ["SHIPPING"],
  rate = "1.0",
  currencyCode = "USD",
} = {}) {
  return {
    presentmentCurrencyRate: rate,
    cart: {
      cost: { subtotalAmount: { amount: subtotal, currencyCode } },
      deliveryGroups: groups.map((options) => ({
        deliveryOptions: options.map((o) =>
          o.handle !== undefined && o.cost !== undefined ? o : deliveryOption(o.handle, o.amount),
        ),
      })),
    },
    discount: { discountClasses, metafield: mf ?? null },
  };
}

export function deliveryFixture(input, output) {
  return {
    payload: {
      export: "cart-delivery-options-discounts-generate-run",
      target: "cart.delivery-options.discounts.generate.run",
      input,
      output,
    },
  };
}

export function deliveryOps(candidates) {
  return {
    operations: [
      {
        deliveryDiscountsAdd: {
          selectionStrategy: "ALL",
          candidates: candidates.map((c) => ({
            targets: [{ deliveryOption: { handle: c.handle } }],
            value: c.percent !== undefined ? { percentage: { value: c.percent } } : { fixedAmount: { amount: c.amount } },
          })),
        },
      },
    ],
  };
}
