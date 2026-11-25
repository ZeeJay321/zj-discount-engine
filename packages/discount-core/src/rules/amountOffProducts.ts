import { allocatePercent, allocateProportional } from "../allocate";
import { convertMinor } from "../money";
import type {
  AmountOffProductsConfig,
  Cart,
  CartLine,
  EvaluableRule,
  EvaluateContext,
  LineDiscount,
  RuleResult,
} from "../types";

/** Per-line ceiling that keeps subtotal × 10000 inside the safe integer range. */
export const MAX_LINE_SUBTOTAL_MINOR = 900_000_000_000;

function isUsableLine(line: CartLine): boolean {
  return (
    Number.isInteger(line.quantity) &&
    line.quantity > 0 &&
    Number.isSafeInteger(line.subtotalMinor) &&
    line.subtotalMinor > 0 &&
    line.subtotalMinor <= MAX_LINE_SUBTOTAL_MINOR
  );
}

function matchesTarget(line: CartLine, config: AmountOffProductsConfig): boolean {
  const wanted = config.target.collectionIds;
  const ids = line.collectionIds;
  // Index loops, not for…of: iterators are expensive in the Function's interpreter.
  for (let i = 0; i < ids.length; i++) {
    if (wanted.includes(ids[i])) return true;
  }
  return false;
}

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
    if (isUsableLine(l) && matchesTarget(l, config)) {
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
    totalMinor,
  };
}
