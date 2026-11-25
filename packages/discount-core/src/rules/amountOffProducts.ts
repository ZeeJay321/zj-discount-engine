import { allocatePercent, allocateProportional } from "../allocate";
import { convertMinor } from "../money";
import { isUsableLine, matchesTarget } from "./target";
import type {
  AmountOffProductsConfig,
  Cart,
  CartLine,
  EvaluableRule,
  EvaluateContext,
  LineDiscount,
  RuleResult,
} from "../types";

export { MAX_LINE_SUBTOTAL_MINOR } from "./target";

export function evaluateAmountOffProducts(
  rule: EvaluableRule & { config: AmountOffProductsConfig },
  cart: Cart,
  ctx: EvaluateContext,
): RuleResult {
  const { config } = rule;
  const eligible: CartLine[] = [];
  const subtotals: number[] = [];
  let eligibleSum = 0;
  for (let i = 0; i < cart.lines.length; i++) {
    const l = cart.lines[i];
    if (isUsableLine(l) && matchesTarget(l, config.target)) {
      eligible.push(l);
      subtotals.push(l.subtotalMinor);
      eligibleSum += l.subtotalMinor;
    }
  }

  let amounts: number[];
  const value = config.value;
  if (value.kind === "PERCENTAGE") {
    const bp = Math.round(value.percent * 100);
    amounts = allocatePercent(subtotals, Math.min(Math.max(bp, 0), 10000));
  } else {
    const perUnit = convertMinor(
      value.amountMinor,
      value.currencyCode,
      cart.currencyCode,
      ctx.presentmentCurrencyRate,
    );
    if (value.appliesToEachItem) {
      amounts = new Array(eligible.length);
      for (let i = 0; i < eligible.length; i++) {
        amounts[i] = Math.min(perUnit * eligible[i].quantity, eligible[i].subtotalMinor);
      }
    } else {
      amounts = allocateProportional(Math.min(perUnit, eligibleSum), subtotals);
    }
  }

  const lines: LineDiscount[] = [];
  let totalMinor = 0;
  for (let i = 0; i < eligible.length; i++) {
    const amountMinor = amounts[i];
    if (amountMinor > 0) {
      lines.push({ lineId: eligible[i].id, amountMinor });
      totalMinor += amountMinor;
    }
  }

  return {
    ruleId: rule.ruleId,
    discountClass: "PRODUCT",
    message: rule.title,
    currencyCode: cart.currencyCode,
    lines,
    order: null,
    shipping: [],
    totalMinor,
  };
}
