import { MAX_CART_LINES } from "./limits";
import { evaluateAmountOffProducts } from "./rules/amountOffProducts";
import { evaluateTieredSpend } from "./rules/tieredSpend";
import type { Cart, DiscountClass, EvaluableRule, EvaluateContext, RuleConfig, RuleResult } from "./types";

/**
 * Evaluate one rule against one cart. This is the exact computation the Shopify
 * Function performs. It deliberately ignores dates: Shopify enforces the discount's
 * startsAt/endsAt, and the simulator filters by date before calling this.
 */
export function evaluateRule(rule: EvaluableRule, cart: Cart, ctx: EvaluateContext): RuleResult {
  switch (rule.config.type) {
    case "AMOUNT_OFF_PRODUCTS":
      // Product rules are capped by cart size (Function instruction budget; see README).
      if (cart.lines.length > MAX_CART_LINES) return emptyResult(rule, cart);
      return evaluateAmountOffProducts({ ...rule, config: rule.config }, cart, ctx);
    case "TIERED_SPEND":
      // Order rules read only the subtotal, so they have no cart-size cap.
      return evaluateTieredSpend({ ...rule, config: rule.config }, cart, ctx);
    default: {
      const unknown: never = rule.config;
      throw new Error(`Unsupported rule type: ${String((unknown as { type?: unknown }).type)}`);
    }
  }
}

function emptyResult(rule: EvaluableRule, cart: Cart): RuleResult {
  return {
    ruleId: rule.ruleId,
    discountClass: discountClassFor(rule.config),
    message: rule.title,
    currencyCode: cart.currencyCode,
    lines: [],
    order: null,
    totalMinor: 0,
  };
}

export function discountClassFor(config: RuleConfig): DiscountClass {
  switch (config.type) {
    case "AMOUNT_OFF_PRODUCTS":
      return "PRODUCT";
    case "TIERED_SPEND":
      return "ORDER";
  }
}

/** True when a rule is live at `now` (simulator only — the Function never checks dates). */
export function isActiveAt(rule: { enabled: boolean; startsAt: string; endsAt: string | null }, now: Date): boolean {
  if (!rule.enabled) return false;
  const t = now.getTime();
  if (Date.parse(rule.startsAt) > t) return false;
  if (rule.endsAt !== null && Date.parse(rule.endsAt) <= t) return false;
  return true;
}
