import { evaluateRule, discountClassFor, parseMetafieldPayload } from "@zj/discount-core";
import type { CartInput, CartLinesDiscountsGenerateRunResult } from "../generated/api";
import { toCoreCart, toProductOperations, type LinesInputLike } from "./adapter";

/**
 * Lines/order target. Reads the rule from the discount's metafield, runs the shared
 * core evaluator, and returns exact per-line amounts. Dates are NOT checked here:
 * Shopify only runs this Function while the discount is active (startsAt/endsAt).
 */
export function cartLinesDiscountsGenerateRun(input: CartInput): CartLinesDiscountsGenerateRunResult {
  const parsed = parseMetafieldPayload(input.discount.metafield?.jsonValue);
  if (!parsed.ok) return { operations: [] };

  const payload = parsed.value;
  const discountClass = discountClassFor(payload.config);
  if (discountClass !== "PRODUCT" || !input.discount.discountClasses.includes(discountClass as never)) {
    return { operations: [] };
  }

  const cart = toCoreCart(input as unknown as LinesInputLike, payload);
  const result = evaluateRule(payload, cart, { presentmentCurrencyRate: input.presentmentCurrencyRate });
  return { operations: toProductOperations(result) } as CartLinesDiscountsGenerateRunResult;
}
