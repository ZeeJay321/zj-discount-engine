import { currencyExponent, type RuleConfig } from "@zj/discount-core";

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

export function describeValue(config: RuleConfig): string {
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
