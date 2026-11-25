import limits from "./limits.json";
import type { RuleType } from "./types";

/** Rule types whose Function work grows with cart lines (product discount class). */
export type ProductRuleType = "AMOUNT_OFF_PRODUCTS" | "BUY_X_GET_Y" | "BUNDLE";

/**
 * Largest cart (in distinct cart lines) each product rule type applies to. Measured,
 * not estimated: at this many lines the JavaScript Function stays at or below ~50% of
 * Shopify's 11M instruction limit for that rule type's worst case, with real-length
 * IDs (scripts/function-perf.mjs --sweep; see README). Above it, the rule gives no
 * discount at all — never a partial one. Tiered spend has no cap.
 * Stored as JSON so scripts and a future Rust Function can read the same values.
 */
export const MAX_CART_LINES_BY_TYPE: Readonly<Record<ProductRuleType, number>> = limits.maxCartLines;

/** The cap for a rule type, or null when the type has none (tiered spend). */
export function maxCartLinesFor(type: RuleType): number | null {
  return type === "TIERED_SPEND" ? null : MAX_CART_LINES_BY_TYPE[type];
}
