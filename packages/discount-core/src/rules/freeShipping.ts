import { allocatePercent } from "../allocate";
import { convertMinor } from "../money";
import type {
  Cart,
  DeliveryOption,
  EvaluableRule,
  EvaluateContext,
  FreeShippingConfig,
  RuleResult,
  ShippingDiscount,
} from "../types";
import { cartSubtotalMinor } from "./tieredSpend";

/**
 * Free shipping above a subtotal threshold. Applies to delivery options in every
 * delivery group (ALL options, or only the cheapest per group). Percentage of each
 * option's cost, optionally clamped by a max amount; never above the option cost.
 */
export function evaluateFreeShipping(
  rule: EvaluableRule & { config: FreeShippingConfig },
  cart: Cart,
  ctx: EvaluateContext,
): RuleResult {
  const { config } = rule;
  const base: RuleResult = {
    ruleId: rule.ruleId,
    discountClass: "SHIPPING",
    message: rule.title,
    currencyCode: cart.currencyCode,
    lines: [],
    order: null,
    shipping: [],
    totalMinor: 0,
  };

  const subtotal = cartSubtotalMinor(cart);
  if (subtotal <= 0) return base;

  const threshold = convertMinor(config.thresholdMinor, config.currencyCode, cart.currencyCode, ctx.presentmentCurrencyRate);
  if (subtotal < threshold) return base;

  const groups = cart.deliveryGroups;
  if (!groups || groups.length === 0) return base;

  const bp = Math.min(Math.max(Math.round(config.percent * 100), 0), 10000);
  const percent = bp / 100;
  const maxConverted =
    config.maxAmountMinor === null
      ? null
      : convertMinor(config.maxAmountMinor, config.currencyCode, cart.currencyCode, ctx.presentmentCurrencyRate);

  const shipping: ShippingDiscount[] = [];
  let totalMinor = 0;

  for (let g = 0; g < groups.length; g++) {
    const options = groups[g].options;
    const targets = config.appliesTo === "CHEAPEST" ? cheapestOptions(options) : options;
    for (let i = 0; i < targets.length; i++) {
      const opt = targets[i];
      if (!Number.isSafeInteger(opt.costMinor) || opt.costMinor <= 0) continue;
      const raw = allocatePercent([opt.costMinor], bp)[0];
      let amountMinor = Math.min(raw, opt.costMinor);
      let outPercent: number | null = percent;
      if (maxConverted !== null && amountMinor > maxConverted) {
        amountMinor = Math.min(maxConverted, opt.costMinor);
        outPercent = null;
      }
      if (amountMinor <= 0) continue;
      shipping.push({ handle: opt.handle, amountMinor, percent: outPercent });
      totalMinor += amountMinor;
    }
  }

  if (shipping.length === 0) return base;
  return { ...base, shipping, totalMinor };
}

/** Lowest-cost option(s); ties keep the earliest option only (deterministic). */
function cheapestOptions(options: readonly DeliveryOption[]): DeliveryOption[] {
  let best: DeliveryOption | null = null;
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    if (!Number.isSafeInteger(o.costMinor) || o.costMinor < 0) continue;
    if (best === null || o.costMinor < best.costMinor) best = o;
  }
  return best === null ? [] : [best];
}
