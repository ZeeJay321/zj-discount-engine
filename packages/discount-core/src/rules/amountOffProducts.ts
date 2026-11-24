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
  for (const id of line.collectionIds) {
    if (wanted.includes(id)) return true;
  }
  return false;
}

export function evaluateAmountOffProducts(
  rule: EvaluableRule & { config: AmountOffProductsConfig },
  cart: Cart,
  ctx: EvaluateContext,
): RuleResult {
  const { config } = rule;
  const eligible = cart.lines.filter((l) => isUsableLine(l) && matchesTarget(l, config));
  const subtotals = eligible.map((l) => l.subtotalMinor);

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
      amounts = eligible.map((l) => Math.min(perUnit * l.quantity, l.subtotalMinor));
    } else {
      const sum = subtotals.reduce((a, b) => a + b, 0);
      amounts = allocateProportional(Math.min(perUnit, sum), subtotals);
    }
  }

  const lines: LineDiscount[] = [];
  let totalMinor = 0;
  eligible.forEach((l, i) => {
    const amountMinor = amounts[i];
    if (amountMinor > 0) {
      lines.push({ lineId: l.id, amountMinor });
      totalMinor += amountMinor;
    }
  });

  return {
    ruleId: rule.ruleId,
    discountClass: "PRODUCT",
    message: rule.title,
    currencyCode: cart.currencyCode,
    lines,
    totalMinor,
  };
}
