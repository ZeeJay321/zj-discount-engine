import { evaluateAmountOffProducts } from "./rules/amountOffProducts";
import type { Cart, DiscountClass, EvaluableRule, EvaluateContext, RuleConfig, RuleResult } from "./types";

/**
 * Evaluate one rule against one cart. This is the exact computation the Shopify
 * Function performs. It deliberately ignores dates: Shopify enforces the discount's
 * startsAt/endsAt, and the simulator filters by date before calling this.
 */
export function evaluateRule(rule: EvaluableRule, cart: Cart, ctx: EvaluateContext): RuleResult {
  switch (rule.config.type) {
    case "AMOUNT_OFF_PRODUCTS":
      return evaluateAmountOffProducts({ ...rule, config: rule.config }, cart, ctx);
    default: {
      const unknown: never = rule.config.type;
      throw new Error(`Unsupported rule type: ${String(unknown)}`);
    }
  }
}

export function discountClassFor(config: RuleConfig): DiscountClass {
  switch (config.type) {
    case "AMOUNT_OFF_PRODUCTS":
      return "PRODUCT";
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
