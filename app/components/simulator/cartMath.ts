import {
  currencyExponent,
  decimalToMinor,
  type Cart,
  type CartLine,
  type SimulatableRule,
} from "@zj/discount-core";
import type { SimCartState, SimRuleRow } from "./types";

export function toCoreCart(state: SimCartState): Cart {
  const exp = currencyExponent(state.currencyCode);
  const lines: CartLine[] = [];
  for (const l of state.lines) {
    let unitPriceMinor: number;
    try {
      unitPriceMinor = decimalToMinor(l.unitPrice || "0", exp);
    } catch {
      unitPriceMinor = 0;
    }
    const qty = Math.max(0, Math.floor(Number(l.quantity)) || 0);
    lines.push({
      id: l.id,
      quantity: qty,
      unitPriceMinor,
      subtotalMinor: unitPriceMinor * qty,
      productId: l.productId || undefined,
      variantId: l.variantId || null,
      collectionIds: l.collectionIds,
    });
  }
  const deliveryOptions = [];
  for (const o of state.deliveryOptions) {
    let costMinor = 0;
    try {
      costMinor = decimalToMinor(o.cost || "0", exp);
    } catch {
      costMinor = 0;
    }
    if (!o.handle.trim()) continue;
    deliveryOptions.push({ handle: o.handle.trim(), costMinor });
  }
  const subtotalMinor = lines.reduce((s, l) => s + l.subtotalMinor, 0);
  return {
    currencyCode: state.currencyCode,
    lines,
    subtotalMinor,
    deliveryGroups: deliveryOptions.length ? [{ options: deliveryOptions }] : [],
  };
}

export function toSimulatableRules(rows: SimRuleRow[], selectedIds: ReadonlySet<string>): SimulatableRule[] {
  return rows
    .filter((r) => selectedIds.has(r.ruleId))
    .map((r) => ({
      ruleId: r.ruleId,
      title: r.title,
      config: r.config,
      enabled: r.enabled,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      combinesWith: r.combinesWith,
    }));
}

export function parseRate(rate: string): number | string {
  const t = rate.trim();
  if (!t) return 1;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? t : 1;
}
