import { allocatePercent } from "../allocate";
import { convertMinor } from "../money";
import type { Cart, EvaluableRule, EvaluateContext, RuleResult, TieredSpendConfig } from "../types";
import { MAX_LINE_SUBTOTAL_MINOR } from "./target";

/**
 * Cart subtotal for order rules: the subtotal Shopify reports (Function path, no lines
 * queried) or the sum of usable line subtotals (simulator path).
 */
export function cartSubtotalMinor(cart: Cart): number {
  if (cart.subtotalMinor !== undefined) {
    const s = cart.subtotalMinor;
    return Number.isSafeInteger(s) && s > 0 ? s : 0;
  }
  let sum = 0;
  for (let i = 0; i < cart.lines.length; i++) {
    const l = cart.lines[i];
    if (Number.isInteger(l.quantity) && l.quantity > 0 && Number.isSafeInteger(l.subtotalMinor) && l.subtotalMinor > 0 && l.subtotalMinor <= MAX_LINE_SUBTOTAL_MINOR) {
      sum += l.subtotalMinor;
    }
  }
  return Number.isSafeInteger(sum) ? sum : 0;
}

/**
 * Highest tier whose (converted) threshold the subtotal reaches; exactly at the
 * threshold counts. Percentage tiers use the shared half-up rounding; fixed amounts
 * are converted to the cart currency and clamped to the subtotal.
 */
export function evaluateTieredSpend(
  rule: EvaluableRule & { config: TieredSpendConfig },
  cart: Cart,
  ctx: EvaluateContext,
): RuleResult {
  const { config } = rule;
  const subtotal = cartSubtotalMinor(cart);
  const base: RuleResult = {
    ruleId: rule.ruleId,
    discountClass: "ORDER",
    message: rule.title,
    currencyCode: cart.currencyCode,
    lines: [],
    order: null,
    shipping: [],
    totalMinor: 0,
  };
  if (subtotal <= 0) return base;

  let tierIndex = -1;
  for (let i = 0; i < config.tiers.length; i++) {
    const threshold = convertMinor(config.tiers[i].thresholdMinor, config.currencyCode, cart.currencyCode, ctx.presentmentCurrencyRate);
    if (subtotal >= threshold) tierIndex = i;
  }
  if (tierIndex < 0) return base;

  const value = config.tiers[tierIndex].value;
  let amountMinor: number;
  let percent: number | null = null;
  if (value.kind === "PERCENTAGE") {
    const bp = Math.min(Math.max(Math.round(value.percent * 100), 0), 10000);
    amountMinor = allocatePercent([subtotal], bp)[0];
    percent = bp / 100;
  } else {
    const converted = convertMinor(value.amountMinor, config.currencyCode, cart.currencyCode, ctx.presentmentCurrencyRate);
    amountMinor = Math.min(Math.max(converted, 0), subtotal);
  }
  if (amountMinor <= 0) return base;
  return { ...base, order: { amountMinor, tierIndex, percent }, totalMinor: amountMinor };
}
