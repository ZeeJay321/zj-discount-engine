import { discountClassFor, evaluateRule, parseMetafieldPayload } from "@zj/discount-core";
import type { CartDeliveryOptionsDiscountsGenerateRunResult, DeliveryInput } from "../generated/api";
import { toCoreDeliveryCart, toDeliveryOperations, type DeliveryInputLike } from "./adapter";

const NONE: CartDeliveryOptionsDiscountsGenerateRunResult = { operations: [] };

/**
 * Shipping target. Parses the rule from the discount metafield, runs the shared core
 * evaluator for FREE_SHIPPING, and maps to deliveryDiscountsAdd. Dates are not checked
 * here: Shopify only runs this while the discount is active. PRODUCT/ORDER discounts
 * do not call this target for their class.
 */
export function cartDeliveryOptionsDiscountsGenerateRun(
  input: DeliveryInput,
): CartDeliveryOptionsDiscountsGenerateRunResult {
  const parsed = parseMetafieldPayload(input.discount.metafield?.jsonValue);
  if (!parsed.ok) return NONE;
  const payload = parsed.value;

  const discountClass = discountClassFor(payload.config);
  if (discountClass !== "SHIPPING") return NONE;
  if (!input.discount.discountClasses.includes(discountClass as never)) return NONE;

  const view = input as unknown as DeliveryInputLike;
  const result = evaluateRule(payload, toCoreDeliveryCart(view), {
    presentmentCurrencyRate: input.presentmentCurrencyRate,
  });
  return { operations: toDeliveryOperations(result) } as unknown as CartDeliveryOptionsDiscountsGenerateRunResult;
}
