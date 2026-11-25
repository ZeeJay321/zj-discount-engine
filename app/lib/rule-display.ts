import { currencyExponent, type BuyXGetYConfig, type RuleConfig, type RuleType, type TieredSpendConfig } from "@zj/discount-core";

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
  AMOUNT_OFF_PRODUCTS: "Amount off collections",
  TIERED_SPEND: "Tiered spend",
  BUY_X_GET_Y: "Buy X get Y",
};

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

export function describeValue(config: RuleConfig): string {
  if (config.type === "TIERED_SPEND") return describeTiers(config).join(" · ");
  if (config.type === "BUY_X_GET_Y") return describeBuyXGetY(config);
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
