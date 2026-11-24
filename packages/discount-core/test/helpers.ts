import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AmountOffValue, Cart, CartLine, EvaluableRule } from "../src";

export function loadCart(name: string): Cart {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", "carts", `${name}.json`), "utf8")) as Cart;
}

export const C100 = "gid://shopify/Collection/100";
export const C200 = "gid://shopify/Collection/200";

export function rule(value: AmountOffValue, collectionIds: string[] = [C100], title = "Test rule"): EvaluableRule {
  return {
    ruleId: "rule_1",
    title,
    config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds }, value },
  };
}

export const pct = (percent: number): AmountOffValue => ({ kind: "PERCENTAGE", percent });
export const fixed = (amountMinor: number, appliesToEachItem: boolean, currencyCode = "USD"): AmountOffValue => ({
  kind: "FIXED_AMOUNT",
  amountMinor,
  currencyCode,
  appliesToEachItem,
});

export function hugeCart(lines = 250, quantity = 999, unitMinor = 99999, currencyCode = "USD"): Cart {
  const out: CartLine[] = [];
  for (let i = 0; i < lines; i++) {
    out.push({
      id: `gid://shopify/CartLine/${i}`,
      quantity,
      subtotalMinor: unitMinor * quantity,
      productId: `gid://shopify/Product/${i}`,
      variantId: `gid://shopify/ProductVariant/${i}`,
      collectionIds: i % 2 === 0 ? [C100] : [],
    });
  }
  return { currencyCode, lines: out };
}
