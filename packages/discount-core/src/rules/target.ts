import type { CartLine, ProductTarget } from "../types";

/** Per-line ceiling that keeps subtotal × 10000 inside the safe integer range. */
export const MAX_LINE_SUBTOTAL_MINOR = 900_000_000_000;

/** A line the maths can safely use: positive integer quantity and a safe positive subtotal. */
export function isUsableLine(line: CartLine): boolean {
  return (
    Number.isInteger(line.quantity) &&
    line.quantity > 0 &&
    Number.isSafeInteger(line.subtotalMinor) &&
    line.subtotalMinor > 0 &&
    line.subtotalMinor <= MAX_LINE_SUBTOTAL_MINOR
  );
}

/** Whether the line's product is in the rule's product set (collections or product list). */
export function matchesTarget(line: CartLine, target: ProductTarget): boolean {
  // Index loops, not for…of: iterators are expensive in the Function's interpreter.
  if (target.kind === "PRODUCTS") {
    return line.productId !== undefined && target.productIds.includes(line.productId);
  }
  const wanted = target.collectionIds;
  const ids = line.collectionIds;
  for (let i = 0; i < ids.length; i++) {
    if (wanted.includes(ids[i])) return true;
  }
  return false;
}

/** Unit price in minor units: Shopify's amountPerQuantity, else subtotal / quantity rounded. */
export function unitPriceOf(line: CartLine): number {
  if (line.unitPriceMinor !== undefined && Number.isSafeInteger(line.unitPriceMinor) && line.unitPriceMinor >= 0) {
    return line.unitPriceMinor;
  }
  return Math.round(line.subtotalMinor / line.quantity);
}
