import {
  currencyExponent,
  type BundleConfig,
  type BuyXGetYConfig,
  type RuleConfig,
  type RuleType,
  type TieredSpendConfig,
} from "@zj/discount-core";

export function formatMoneyMinor(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: exp, maximumFractionDigits: exp }).format(
      minor / Math.pow(10, exp),
    );
  } catch {
    return `${(minor / Math.pow(10, exp)).toFixed(exp)} ${currency}`;
  }
}

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  AMOUNT_OFF_PRODUCTS: "Amount off products",
  TIERED_SPEND: "Tiered spend",
  BUY_X_GET_Y: "Buy X get Y",
  BUNDLE: "Bundle",
};

/**
 * e.g. "Shirt + 2× Jeans + Belt: 20% off (up to 3 times per order)". `titles` maps
 * product/variant GIDs to names; unknown ones show as "?" (incomplete drafts).
 */
export function describeBundle(c: BundleConfig, titles: Record<string, string> = {}): string {
  const n = (v: number) => (Number.isFinite(v) ? String(v) : "?");
  const items = c.components.map((comp) => {
    const id = comp.kind === "VARIANT" ? comp.variantId : comp.productId;
    const name = (id && titles[id]) || "?";
    return comp.quantity === 1 ? name : `${n(comp.quantity)}× ${name}`;
  });
  const money = (m: number) => (Number.isSafeInteger(m) ? formatMoneyMinor(m, c.currencyCode) : "?");
  const v = c.value;
  const deal =
    v.kind === "PERCENTAGE"
      ? v.percent === 100
        ? "free"
        : `${Number.isFinite(v.percent) ? v.percent : "?"}% off`
      : v.kind === "FIXED_AMOUNT"
        ? `${money(v.amountMinor)} off each bundle`
        : `bundle price ${money(v.priceMinor)}`;
  const times = c.limitPerOrder === 1 ? "once per order" : `up to ${n(c.limitPerOrder)} times per order`;
  return `${items.join(" + ")}: ${deal} (${times})`;
}

/** e.g. "Buy 2, get 1 free (up to 3 times per order)". Tolerates incomplete drafts (preview). */
export function describeBuyXGetY(c: BuyXGetYConfig): string {
  const n = (v: number) => (Number.isFinite(v) ? String(v) : "?");
  const off = c.percent === 100 ? "free" : `at ${Number.isFinite(c.percent) ? c.percent : "?"}% off`;
  const times = c.limitPerOrder === 1 ? "once per order" : `up to ${n(c.limitPerOrder)} times per order`;
  return `Buy ${n(c.buyQuantity)}, get ${n(c.getQuantity)} ${off} (${times})`;
}

/** One line per tier, e.g. "Spend $100.00 or more: 10% off". */
export function describeTiers(config: TieredSpendConfig): string[] {
  return config.tiers.map((t) => {
    const spend = Number.isSafeInteger(t.thresholdMinor) ? formatMoneyMinor(t.thresholdMinor, config.currencyCode) : "?";
    const off =
      t.value.kind === "PERCENTAGE"
        ? `${Number.isFinite(t.value.percent) ? t.value.percent : "?"}% off`
        : `${Number.isSafeInteger(t.value.amountMinor) ? formatMoneyMinor(t.value.amountMinor, config.currencyCode) : "?"} off`;
    return `Spend ${spend} or more: ${off}`;
  });
}

export function describeValue(config: RuleConfig, titles: Record<string, string> = {}): string {
  if (config.type === "TIERED_SPEND") return describeTiers(config).join(" · ");
  if (config.type === "BUY_X_GET_Y") return describeBuyXGetY(config);
  if (config.type === "BUNDLE") return describeBundle(config, titles);
  const v = config.value;
  if (v.kind === "PERCENTAGE") return `${v.percent}% off`;
  return `${formatMoneyMinor(v.amountMinor, v.currencyCode)} off ${v.appliesToEachItem ? "each item" : "once per order"}`;
}

export function formatDay(iso: string | null, timeZone: string): string {
  if (!iso) return "No end date";
  try {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
