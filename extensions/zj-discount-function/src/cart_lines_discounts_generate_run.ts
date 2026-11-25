import { discountClassFor, evaluateRule, maxCartLinesFor, parseMetafieldPayload, targetOf } from "@zj/discount-core";
import type { CartInput, CartLinesDiscountsGenerateRunResult } from "../generated/api";
import {
  bundleFilter,
  targetFilter,
  toCoreCart,
  toCoreOrderCart,
  toOrderOperations,
  toProductOperations,
  type LineFilter,
  type LinesInputLike,
} from "./adapter";

const NONE: CartLinesDiscountsGenerateRunResult = { operations: [] };

/**
 * Lines/order target. Parses the rule from the discount metafield once, runs the
 * shared core evaluator, and maps the result to Shopify operations.
 * - Dates are NOT checked here: Shopify only runs this while the discount is active.
 * - Product rules (amount off, buy X get Y, bundles): carts above the rule type's
 *   measured cap (maxCartLinesFor) get no
 *   discount at all (instruction budget).
 * - Order rules (tiered spend): only the cart subtotal is used; no cart-size cap
 *   (measured well under the limit even at 200 lines; see README).
 */
export function cartLinesDiscountsGenerateRun(input: CartInput): CartLinesDiscountsGenerateRunResult {
  const parsed = parseMetafieldPayload(input.discount.metafield?.jsonValue);
  if (!parsed.ok) return NONE;
  const payload = parsed.value;

  const discountClass = discountClassFor(payload.config);
  if (!input.discount.discountClasses.includes(discountClass as never)) return NONE;
  const view = input as unknown as LinesInputLike;
  const ctx = { presentmentCurrencyRate: input.presentmentCurrencyRate };

  if (discountClass === "ORDER") {
    const result = evaluateRule(payload, toCoreOrderCart(view), ctx);
    return { operations: toOrderOperations(result) } as unknown as CartLinesDiscountsGenerateRunResult;
  }

  const lineCount = view.cart.lines.length;
  if (lineCount === 0 || lineCount > (maxCartLinesFor(payload.config.type) ?? Infinity)) return NONE;
  const config = payload.config;
  let keep: LineFilter;
  if (config.type === "BUNDLE") keep = bundleFilter(config.components);
  else {
    const target = targetOf(config);
    if (target === null) return NONE;
    keep = targetFilter(target);
  }
  const cart = toCoreCart(view, keep, payload.collectionIds);
  const result = evaluateRule(payload, cart, ctx);
  return { operations: toProductOperations(result) } as unknown as CartLinesDiscountsGenerateRunResult;
}
