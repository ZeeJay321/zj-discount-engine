/**
 * Cart simulator: same per-rule maths as the Function (`evaluateRule`), plus an
 * estimate of how Shopify might combine multiple discounts. No I/O; no Date.now().
 */
import { discountClassFor, evaluateRule, isActiveAt } from "./evaluate";
import { maxCartLinesFor } from "./limits";
import { cartSubtotalMinor } from "./rules/tieredSpend";
import type {
  Cart,
  CombinesWith,
  DiscountClass,
  EvaluableRule,
  EvaluateContext,
  RuleResult,
} from "./types";

/**
 * Whether tier / order-% thresholds use the cart subtotal before or after product
 * discounts in the combined estimate. Default assumes before. Confirm on a real store.
 */
export type TierBasis = "before_product_discounts" | "after_product_discounts";
export const TIER_BASIS: TierBasis = "before_product_discounts";

export type SimulatableRule = EvaluableRule & {
  enabled: boolean;
  startsAt: string;
  endsAt: string | null;
  combinesWith: CombinesWith;
};

export type NoDiscountReasonCode =
  | "outside_dates"
  | "above_line_cap"
  | "empty_cart"
  | "below_threshold"
  | "no_matching_lines"
  | "no_delivery_options"
  | "no_discount";

export interface PerRuleSimulation {
  ruleId: string;
  title: string;
  discountClass: DiscountClass;
  /** Exact evaluateRule output when the rule was evaluated; empty when skipped. */
  result: RuleResult;
  /** Null when the rule produced a discount. */
  reason: NoDiscountReasonCode | null;
  /** Human-readable detail (e.g. cap number, date window). */
  reasonDetail: string | null;
  /** Included in the combined estimate (in date and totalMinor > 0 after stacking pick). */
  includedInEstimate: boolean;
}

export interface SimulateResult {
  perRule: PerRuleSimulation[];
  /** Sum of product + order + shipping amounts chosen by the estimate. */
  combinedTotalMinor: number;
  productTotalMinor: number;
  orderTotalMinor: number;
  shippingTotalMinor: number;
  tierBasis: TierBasis;
  /** Rule IDs that contributed to the estimate (after greedy combine). */
  estimateRuleIds: string[];
}

export interface SimulateOptions {
  tierBasis?: TierBasis;
  presentmentCurrencyRate?: number | string;
}

export function simulate(
  rules: readonly SimulatableRule[],
  cart: Cart,
  now: Date,
  options: SimulateOptions = {},
): SimulateResult {
  const tierBasis = options.tierBasis ?? TIER_BASIS;
  const ctx: EvaluateContext = {
    presentmentCurrencyRate: options.presentmentCurrencyRate ?? 1,
  };

  const perRule: PerRuleSimulation[] = [];
  const evaluated: Array<{ rule: SimulatableRule; result: RuleResult }> = [];

  for (const rule of rules) {
    const discountClass = discountClassFor(rule.config);
    const empty = emptyResult(rule, cart, discountClass);

    if (!isActiveAt(rule, now)) {
      perRule.push({
        ruleId: rule.ruleId,
        title: rule.title,
        discountClass,
        result: empty,
        reason: "outside_dates",
        reasonDetail: dateWindowDetail(rule),
        includedInEstimate: false,
      });
      continue;
    }

    const cap = maxCartLinesFor(rule.config.type);
    if (cap !== null && cart.lines.length > cap) {
      perRule.push({
        ruleId: rule.ruleId,
        title: rule.title,
        discountClass,
        result: empty,
        reason: "above_line_cap",
        reasonDetail: `Cart has ${cart.lines.length} lines; this rule type is capped at ${cap}.`,
        includedInEstimate: false,
      });
      continue;
    }

    const result = evaluateRule(rule, cart, ctx);
    let reason: NoDiscountReasonCode | null = null;
    let reasonDetail: string | null = null;
    if (result.totalMinor <= 0) {
      const explained = explainZero(rule, cart);
      reason = explained.code;
      reasonDetail = explained.detail;
    } else {
      evaluated.push({ rule, result });
    }

    perRule.push({
      ruleId: rule.ruleId,
      title: rule.title,
      discountClass,
      result,
      reason,
      reasonDetail,
      includedInEstimate: false,
    });
  }

  const productPicked = greedyPick(
    evaluated.filter((e) => e.result.discountClass === "PRODUCT"),
    "productDiscounts",
  );

  const productTotalMinor = sumTotals(productPicked);

  const orderCandidates = evaluated.filter((e) => e.result.discountClass === "ORDER");
  let orderPicked: Array<{ rule: SimulatableRule; result: RuleResult }>;
  if (tierBasis === "after_product_discounts" && productTotalMinor > 0 && orderCandidates.length > 0) {
    const originalSub = cartSubtotalMinor(cart);
    const adjustedSub = Math.max(0, originalSub - productTotalMinor);
    const reEval: Array<{ rule: SimulatableRule; result: RuleResult }> = [];
    for (const { rule } of orderCandidates) {
      const adjustedCart: Cart = { ...cart, subtotalMinor: adjustedSub, lines: cart.lines };
      const result = evaluateRule(rule, adjustedCart, ctx);
      if (result.totalMinor > 0) reEval.push({ rule, result });
    }
    orderPicked = greedyPick(reEval, "orderDiscounts");
  } else {
    orderPicked = greedyPick(orderCandidates, "orderDiscounts");
  }

  const shippingPicked = greedyPick(
    evaluated.filter((e) => e.result.discountClass === "SHIPPING"),
    "shippingDiscounts",
  );

  const orderTotalMinor = sumTotals(orderPicked);
  const shippingTotalMinor = sumTotals(shippingPicked);
  const estimateRuleIds = [...productPicked, ...orderPicked, ...shippingPicked].map((e) => e.rule.ruleId);
  const included = new Set(estimateRuleIds);
  for (const row of perRule) {
    if (included.has(row.ruleId)) row.includedInEstimate = true;
  }

  const combinedTotalMinor = Math.max(0, productTotalMinor + orderTotalMinor + shippingTotalMinor);

  return {
    perRule,
    combinedTotalMinor,
    productTotalMinor,
    orderTotalMinor,
    shippingTotalMinor,
    tierBasis,
    estimateRuleIds,
  };
}

function emptyResult(rule: EvaluableRule, cart: Cart, discountClass: DiscountClass): RuleResult {
  return {
    ruleId: rule.ruleId,
    discountClass,
    message: rule.title,
    currencyCode: cart.currencyCode,
    lines: [],
    order: null,
    shipping: [],
    totalMinor: 0,
  };
}

function dateWindowDetail(rule: SimulatableRule): string {
  return rule.endsAt
    ? `Active ${rule.startsAt} → ${rule.endsAt} (end exclusive).`
    : `Starts ${rule.startsAt}, no end date.`;
}

function explainZero(
  rule: SimulatableRule,
  cart: Cart,
): { code: NoDiscountReasonCode; detail: string } {
  const sub = cartSubtotalMinor(cart);
  if (cart.lines.length === 0 && (cart.deliveryGroups?.length ?? 0) === 0 && sub <= 0) {
    return { code: "empty_cart", detail: "Cart has no lines and no subtotal." };
  }

  const t = rule.config.type;
  if (t === "TIERED_SPEND") {
    if (sub <= 0) return { code: "empty_cart", detail: "Cart subtotal is zero." };
    return { code: "below_threshold", detail: "Cart subtotal is below every tier threshold." };
  }
  if (t === "FREE_SHIPPING") {
    const groups = cart.deliveryGroups ?? [];
    const optionCount = groups.reduce((n, g) => n + g.options.length, 0);
    if (optionCount === 0) {
      return { code: "no_delivery_options", detail: "No delivery options to discount." };
    }
    if (sub <= 0) return { code: "empty_cart", detail: "Cart subtotal is zero." };
    return { code: "below_threshold", detail: "Cart subtotal is below the free-shipping threshold." };
  }
  if (t === "AMOUNT_OFF_PRODUCTS" || t === "BUY_X_GET_Y" || t === "BUNDLE") {
    if (cart.lines.length === 0) return { code: "empty_cart", detail: "Cart has no lines." };
    return { code: "no_matching_lines", detail: "No cart lines matched this rule's products or set." };
  }
  return { code: "no_discount", detail: "No discount applied." };
}

type CombineFlag = keyof CombinesWith;

/**
 * Greedy combine: sort by total desc; keep a candidate if it and every already-kept
 * rule allow stacking on `flag` (both sides). Otherwise the largest alone wins when
 * none can stack with it.
 */
function greedyPick(
  items: Array<{ rule: SimulatableRule; result: RuleResult }>,
  flag: CombineFlag,
): Array<{ rule: SimulatableRule; result: RuleResult }> {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => {
    if (b.result.totalMinor !== a.result.totalMinor) return b.result.totalMinor - a.result.totalMinor;
    return a.rule.ruleId < b.rule.ruleId ? -1 : a.rule.ruleId > b.rule.ruleId ? 1 : 0;
  });
  const kept: Array<{ rule: SimulatableRule; result: RuleResult }> = [];
  for (const item of sorted) {
    if (kept.length === 0) {
      kept.push(item);
      continue;
    }
    const canJoin = kept.every(
      (k) => k.rule.combinesWith[flag] && item.rule.combinesWith[flag],
    );
    if (canJoin) kept.push(item);
  }
  return kept;
}

function sumTotals(items: Array<{ result: RuleResult }>): number {
  let n = 0;
  for (const i of items) n += i.result.totalMinor;
  return n;
}
