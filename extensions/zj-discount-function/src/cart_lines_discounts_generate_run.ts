import { discountClassFor, evaluateRule, MAX_CART_LINES, parseMetafieldPayload } from "@zj/discount-core";
import type { CartInput, CartLinesDiscountsGenerateRunResult } from "../generated/api";
import { toCoreCart, toProductOperations, type LinesInputLike } from "./adapter";

const NONE: CartLinesDiscountsGenerateRunResult = { operations: [] };

/**
 * Lines/order target. Parses the rule from the discount metafield once, runs the
 * shared core evaluator, and returns exact per-line amounts.
 * - Dates are NOT checked here: Shopify only runs this while the discount is active.
 * - Carts above MAX_CART_LINES get no discount at all (instruction budget; see README).
 */
export function cartLinesDiscountsGenerateRun(input: CartInput): CartLinesDiscountsGenerateRunResult {
  const lineCount = input.cart.lines.length;
  if (lineCount === 0 || lineCount > MAX_CART_LINES) return NONE;

  const parsed = parseMetafieldPayload(input.discount.metafield?.jsonValue);
  if (!parsed.ok) return NONE;
  const payload = parsed.value;

  const discountClass = discountClassFor(payload.config);
  if (discountClass !== "PRODUCT" || !input.discount.discountClasses.includes(discountClass as never)) return NONE;

  const cart = toCoreCart(input as unknown as LinesInputLike, payload.collectionIds);
  const result = evaluateRule(payload, cart, { presentmentCurrencyRate: input.presentmentCurrencyRate });
  return { operations: toProductOperations(result) } as CartLinesDiscountsGenerateRunResult;
}
