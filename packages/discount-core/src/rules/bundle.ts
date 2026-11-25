import { convertMinor } from "../money";
import type { BundleComponent, BundleConfig, Cart, CartLine, EvaluableRule, EvaluateContext, LineDiscount, RuleResult } from "../types";
import { isUsableLine, unitPriceOf } from "./target";

const KEY_BASE = 1024;

/** Index of the component a line belongs to (first match), or -1. */
export function componentIndexOf(line: CartLine, components: readonly BundleComponent[]): number {
  for (let k = 0; k < components.length; k++) {
    const c = components[k];
    if (c.kind === "VARIANT" ? line.variantId === c.variantId : line.productId === c.productId) return k;
  }
  return -1;
}

/** Positions (into `units`) sorted by unit price ascending, ties by original order. */
function cheapestFirst(units: number[]): number[] {
  const n = units.length;
  const order: number[] = new Array(n);
  if (n < KEY_BASE) {
    const keys = new Float64Array(n);
    for (let j = 0; j < n; j++) keys[j] = units[j] * KEY_BASE + j;
    keys.sort(); // native numeric sort: no JS comparator calls
    for (let j = 0; j < n; j++) order[j] = keys[j] - Math.floor(keys[j] / KEY_BASE) * KEY_BASE;
  } else {
    for (let j = 0; j < n; j++) order[j] = j;
    order.sort((a, b) => units[a] - units[b] || a - b);
  }
  return order;
}

/**
 * Largest-remainder split of `total` over `weights[0..n)` into `out` — the same result
 * as allocateProportional (shares sum to total, never above a weight when total <= sum,
 * extra units to the largest remainders, ties to the earlier index), but allocation-free
 * and comparator-free: bundles have few pieces, and this runs once per bundle.
 */
function splitSmall(total: number, weights: number[], n: number, out: number[], rem: number[]): void {
  let sumW = 0;
  for (let i = 0; i < n; i++) sumW += weights[i];
  if (total <= 0 || sumW <= 0) {
    for (let i = 0; i < n; i++) out[i] = 0;
    return;
  }
  let sumQ = 0;
  for (let i = 0; i < n; i++) {
    const exact = (total * weights[i]) / sumW;
    const q = Math.floor(exact);
    out[i] = q;
    rem[i] = exact - q;
    sumQ += q;
  }
  let extra = total - sumQ;
  while (extra > 0) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (out[i] >= weights[i]) continue; // total <= sumW here, so caps always apply
      if (best < 0 || rem[i] > rem[best]) best = i;
    }
    if (best < 0) break;
    out[best] += 1;
    rem[best] = -1; // one extra unit per piece, like a single pass of largest remainder
    extra--;
  }
}

interface Group {
  /** cart line indexes, in cart order */
  lines: number[];
  units: number[];
  qty: number[];
  total: number;
  /** positions in `lines`, cheapest first */
  order: number[];
}

/**
 * Bundles. Complete bundles = min over components of floor(units / quantity), capped by
 * the limit per order. Within each component the CHEAPEST units are used first (ties:
 * earlier cart line), and only units in complete bundles are discounted. Quantities are
 * never expanded: units are taken from sorted lines by count.
 *
 * - Percentage: each bundle unit gets round-half-up(unit × percent) off (per-unit, like
 *   Shopify's percentage rounding).
 * - Fixed amount off each bundle / fixed bundle price: per bundle, discount =
 *   min(amount, bundle total) or clamp(bundle total − price, 0, total), spread over the
 *   bundle's line pieces with the largest-remainder allocation so the parts add up.
 *
 * Each line's discount covers exactly the units it contributed (`quantity`); the Function
 * sends it as a fixed amount on `cartLine { id, quantity }`, so checkout matches exactly.
 */
export function evaluateBundle(rule: EvaluableRule & { config: BundleConfig }, cart: Cart, ctx: EvaluateContext): RuleResult {
  const c = rule.config;
  const result: RuleResult = {
    ruleId: rule.ruleId,
    discountClass: "PRODUCT",
    message: rule.title,
    currencyCode: cart.currencyCode,
    lines: [],
    order: null,
    shipping: [],
    totalMinor: 0,
  };
  const comps = c.components;
  const limit = c.limitPerOrder;
  if (!Array.isArray(comps) || comps.length === 0 || !Number.isInteger(limit) || limit < 1) return result;
  for (let k = 0; k < comps.length; k++) {
    if (!Number.isInteger(comps[k].quantity) || comps[k].quantity < 1) return result;
  }

  // Group usable lines by component.
  const groups: Group[] = comps.map(() => ({ lines: [], units: [], qty: [], total: 0, order: [] }));
  for (let i = 0; i < cart.lines.length; i++) {
    const l = cart.lines[i];
    if (!isUsableLine(l)) continue;
    const k = componentIndexOf(l, comps);
    if (k < 0) continue;
    const g = groups[k];
    g.lines.push(i);
    g.units.push(Math.min(unitPriceOf(l), l.subtotalMinor));
    g.qty.push(l.quantity);
    g.total += l.quantity;
  }

  let bundles = limit;
  for (let k = 0; k < comps.length; k++) bundles = Math.min(bundles, Math.floor(groups[k].total / comps[k].quantity));
  if (bundles <= 0) return result;
  for (const g of groups) g.order = cheapestFirst(g.units);

  // Per cart line: units taken into bundles and the discount on them (plain arrays).
  const nLines = cart.lines.length;
  const takenQty = new Array<number>(nLines).fill(0);
  const amount = new Array<number>(nLines).fill(0);
  const add = (lineIdx: number, units: number, minor: number) => {
    takenQty[lineIdx] += units;
    amount[lineIdx] += minor;
  };

  const v = c.value;
  if (v.kind === "PERCENTAGE") {
    const bp = Math.min(Math.max(Math.round(v.percent * 100), 0), 10000);
    if (!(bp > 0)) return result;
    for (let k = 0; k < comps.length; k++) {
      const g = groups[k];
      let need = bundles * comps[k].quantity;
      for (let j = 0; j < g.order.length && need > 0; j++) {
        const p = g.order[j];
        const take = Math.min(need, g.qty[p]);
        need -= take;
        add(g.lines[p], take, take * Math.floor((g.units[p] * bp + 5000) / 10000));
      }
    }
  } else {
    const fixed = convertMinor(v.kind === "FIXED_AMOUNT" ? v.amountMinor : v.priceMinor, c.currencyCode, cart.currencyCode, ctx.presentmentCurrencyRate);
    // Walk each component's cheapest-first queue, one bundle at a time (≤ limit ≤ 100 bundles).
    const pos = groups.map(() => 0);
    const used = groups.map(() => 0); // units already used from the line at pos
    // Piece buffers reused across bundles (a bundle has at most Σ quantities pieces).
    const pieceLine: number[] = [];
    const pieceUnits: number[] = [];
    const pieceTotal: number[] = [];
    const shares: number[] = [];
    const rem: number[] = [];
    const discountFor = (bundleTotal: number) =>
      v.kind === "FIXED_AMOUNT" ? Math.min(Math.max(fixed, 0), bundleTotal) : Math.min(Math.max(bundleTotal - fixed, 0), bundleTotal);
    for (let b = 0; b < bundles; ) {
      // Run of identical bundles: while every component can take its whole quantity from
      // its current line, consecutive bundles have the same pieces, hence the same
      // discount and split. Compute it once and multiply — cost then depends on the number
      // of distinct bundle compositions, not on the limit (large quantities stay cheap).
      let run = bundles - b;
      for (let k = 0; k < comps.length && run > 0; k++) {
        const g = groups[k];
        run = Math.min(run, Math.floor((g.qty[g.order[pos[k]]] - used[k]) / comps[k].quantity));
      }
      if (run >= 1) {
        let bundleTotal = 0;
        for (let k = 0; k < comps.length; k++) {
          const g = groups[k];
          const p = g.order[pos[k]];
          pieceLine[k] = g.lines[p];
          pieceUnits[k] = comps[k].quantity;
          pieceTotal[k] = comps[k].quantity * g.units[p];
          bundleTotal += pieceTotal[k];
        }
        splitSmall(discountFor(bundleTotal), pieceTotal, comps.length, shares, rem);
        for (let k = 0; k < comps.length; k++) {
          add(pieceLine[k], pieceUnits[k] * run, shares[k] * run);
          const g = groups[k];
          used[k] += comps[k].quantity * run;
          if (used[k] === g.qty[g.order[pos[k]]]) {
            pos[k]++;
            used[k] = 0;
          }
        }
        b += run;
        continue;
      }
      // A component's units span lines for this bundle: build it piece by piece.
      b++;
      let np = 0;
      let bundleTotal = 0;
      for (let k = 0; k < comps.length; k++) {
        const g = groups[k];
        let need = comps[k].quantity;
        while (need > 0) {
          const p = g.order[pos[k]];
          const take = Math.min(need, g.qty[p] - used[k]);
          pieceLine[np] = g.lines[p];
          pieceUnits[np] = take;
          pieceTotal[np] = take * g.units[p];
          np++;
          bundleTotal += take * g.units[p];
          need -= take;
          used[k] += take;
          if (used[k] === g.qty[p]) {
            pos[k]++;
            used[k] = 0;
          }
        }
      }
      splitSmall(discountFor(bundleTotal), pieceTotal, np, shares, rem);
      for (let q = 0; q < np; q++) add(pieceLine[q], pieceUnits[q], shares[q]);
    }
  }

  // Emit in cart order; only lines that actually get a discount.
  const lines: LineDiscount[] = [];
  let total = 0;
  for (let i = 0; i < nLines; i++) {
    const a = amount[i];
    if (a <= 0) continue;
    lines.push({ lineId: cart.lines[i].id, amountMinor: a, quantity: takenQty[i] });
    total += a;
  }
  result.lines = lines;
  result.totalMinor = total;
  return result;
}
