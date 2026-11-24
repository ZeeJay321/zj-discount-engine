import limits from "./limits.json";

/**
 * Largest cart (in distinct cart lines) a rule applies to. Measured, not estimated:
 * at this many lines the JavaScript Function stays at or below ~50% of Shopify's
 * 11M instruction limit (see scripts/function-perf.mjs --sweep and the README).
 * Above it, rules give no discount at all — never a partial one.
 * Stored as JSON so scripts and a future Rust Function can read the same value.
 */
export const MAX_CART_LINES: number = limits.maxCartLines;
