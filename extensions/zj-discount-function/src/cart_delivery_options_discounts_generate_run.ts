import type { CartDeliveryOptionsDiscountsGenerateRunResult, DeliveryInput } from "../generated/api";

/**
 * Shipping target. Wired up now so the extension has both targets; it returns no
 * operations until the free-shipping rule type lands (Phase B). Amount-off-products
 * discounts only carry the PRODUCT class, so Shopify does not call this for them.
 */
export function cartDeliveryOptionsDiscountsGenerateRun(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _input: DeliveryInput,
): CartDeliveryOptionsDiscountsGenerateRunResult {
  return { operations: [] };
}
