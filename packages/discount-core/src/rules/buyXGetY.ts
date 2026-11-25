import type { BuyXGetYConfig, Cart, EvaluableRule, EvaluateContext, LineDiscount, RuleResult } from "../types";
import { isUsableLine, matchesTarget, unitPriceOf } from "./target";

/** Sort-key multiplier: key = unitPrice × KEY_BASE + lineIndex (needs lineIndex < KEY_BASE). */
const KEY_BASE = 1024;

/**
 * Buy X get Y from the same product set.
 *
 * sets = min(floor(eligibleUnits / (X + Y)), limitPerOrder); Y × sets units are
 * discounted, taken from the CHEAPEST eligible units (ties: earlier cart line first).
 * Quantities are never expanded into units: lines are sorted by unit price and units
 * are consumed line by line, so the cost depends on the number of lines only.
 *
 * Each discounted unit gets round-half-up(unitPrice × percent) off — per-unit rounding,
 * like Shopify's — and a line's discount is that × the units taken from it. The Function
 * sends it as a fixed amount on exactly those units (`cartLine { id, quantity }`), so
 * checkout matches this to the minor unit. Percentages need no currency conversion:
 * unit prices are already in the cart currency.
 */
export function evaluateBuyXGetY(
  rule: EvaluableRule & { config: BuyXGetYConfig },
  cart: Cart,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ctx: EvaluateContext,
): RuleResult {
  const c = rule.config;
  const result: RuleResult = {
    ruleId: rule.ruleId,
    discountClass: "PRODUCT",
    message: rule.title,
    currencyCode: cart.currencyCode,
    lines: [],
    order: null,
    totalMinor: 0,
  };
  const X = c.buyQuantity;
  const Y = c.getQuantity;
  const limit = c.limitPerOrder;
  if (!Number.isInteger(X) || X < 1 || !Number.isInteger(Y) || Y < 1 || !Number.isInteger(limit) || limit < 1) return result;
  const bp = Math.min(Math.max(Math.round(c.percent * 100), 0), 10000);
  if (!(bp > 0)) return result;

  // Eligible lines (in cart order) and their unit prices.
  const idx: number[] = [];
  const units: number[] = [];
  let totalUnits = 0;
  for (let i = 0; i < cart.lines.length; i++) {
    const l = cart.lines[i];
    if (!isUsableLine(l) || !matchesTarget(l, c.target)) continue;
    idx.push(i);
    units.push(Math.min(unitPriceOf(l), l.subtotalMinor));
    totalUnits += l.quantity;
  }
  const n = idx.length;
  if (n === 0) return result;

  const sets = Math.min(Math.floor(totalUnits / (X + Y)), limit);
  let remaining = sets * Y;
  if (remaining <= 0) return result;

  // Cheapest first, ties by cart order. A native numeric sort of composite keys avoids
  // JS comparator calls (expensive in the Function's interpreter).
  const order: number[] = new Array(n);
  if (n < KEY_BASE) {
    const keys = new Float64Array(n);
    for (let j = 0; j < n; j++) keys[j] = units[j] * KEY_BASE + j;
    keys.sort();
    for (let j = 0; j < n; j++) order[j] = keys[j] - Math.floor(keys[j] / KEY_BASE) * KEY_BASE;
  } else {
    for (let j = 0; j < n; j++) order[j] = j;
    order.sort((a, b) => units[a] - units[b] || a - b);
  }

  // Consume discounted units line by line; record per eligible line.
  const taken = new Array<number>(n).fill(0);
  for (let j = 0; j < n && remaining > 0; j++) {
    const e = order[j];
    const take = Math.min(remaining, cart.lines[idx[e]].quantity);
    taken[e] = take;
    remaining -= take;
  }

  // Emit in cart order (deterministic, readable output).
  const lines: LineDiscount[] = [];
  let total = 0;
  for (let e = 0; e < n; e++) {
    const take = taken[e];
    if (take === 0) continue;
    const perUnit = Math.floor((units[e] * bp + 5000) / 10000);
    const amountMinor = take * perUnit;
    if (amountMinor <= 0) continue;
    lines.push({ lineId: cart.lines[idx[e]].id, amountMinor, quantity: take });
    total += amountMinor;
  }
  result.lines = lines;
  result.totalMinor = total;
  return result;
}
