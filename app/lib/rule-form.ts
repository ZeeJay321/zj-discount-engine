/**
 * Rule form ⇄ RuleDraft conversion. Shared by the browser (pre-submit validation)
 * and the route action (authoritative validation), so both see the same draft.
 * Dates are entered as shop-local calendar days and stored as UTC instants.
 */
import {
  currencyExponent,
  targetOf,
  formatMinor,
  parseDecimalToMinor,
  type AmountOffProductsConfig,
  type ProductTarget,
  type RuleConfig,
  type RuleDraft,
  type RuleType,
  type SpendTier,
  type ValidationError,
} from "@zj/discount-core";

export interface FormContext {
  shopCurrency: string;
  /** IANA timezone of the shop, e.g. "America/New_York" */
  timezone: string;
}

export interface ParsedRuleForm {
  draft: RuleDraft;
  /** Errors from parsing (e.g. an amount that isn't a number); run validateRule for the rest. */
  errors: ValidationError[];
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const num = (s: string) => (s === "" ? Number.NaN : Number(s));

export function parseRuleForm(fd: FormData, ctx: FormContext): ParsedRuleForm {
  const errors: ValidationError[] = [];
  const rawType = str(fd, "ruleType");
  const ruleType: RuleType = rawType === "TIERED_SPEND" || rawType === "BUY_X_GET_Y" ? rawType : "AMOUNT_OFF_PRODUCTS";
  // Product set shared by amount-off and buy X get Y: collections or a product list.
  const targetIds = fd.getAll("targetIds").filter((v): v is string => typeof v === "string" && v !== "");
  const target: ProductTarget =
    str(fd, "targetKind") === "PRODUCTS" ? { kind: "PRODUCTS", productIds: targetIds } : { kind: "COLLECTIONS", collectionIds: targetIds };
  const exp = currencyExponent(ctx.shopCurrency);
  const amount = (raw: string, field: string, emptyMessage: string): number => {
    try {
      return parseDecimalToMinor(raw, exp);
    } catch {
      errors.push({ field, message: raw ? "Enter a valid amount, e.g. 5.00." : emptyMessage });
      return Number.NaN;
    }
  };

  let config: RuleConfig;
  if (ruleType === "TIERED_SPEND") {
    const kind = str(fd, "tierKind") === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
    const thresholds = fd.getAll("tierThreshold").map((v) => (typeof v === "string" ? v.trim() : ""));
    const values = fd.getAll("tierValue").map((v) => (typeof v === "string" ? v.trim() : ""));
    const tiers: SpendTier[] = thresholds.map((t, i) => ({
      thresholdMinor: amount(t, `config.tiers.${i}.threshold`, "Enter a spend amount."),
      value:
        kind === "PERCENTAGE"
          ? { kind: "PERCENTAGE", percent: num(values[i] ?? "") }
          : { kind: "FIXED_AMOUNT", amountMinor: amount(values[i] ?? "", `config.tiers.${i}.value`, "Enter an amount.") },
    }));
    config = { type: "TIERED_SPEND", currencyCode: ctx.shopCurrency, tiers };
  } else if (ruleType === "BUY_X_GET_Y") {
    config = {
      type: "BUY_X_GET_Y",
      target,
      buyQuantity: num(str(fd, "buyQuantity")),
      getQuantity: num(str(fd, "getQuantity")),
      percent: num(str(fd, "bogoPercent")),
      limitPerOrder: num(str(fd, "limitPerOrder")),
    };
  } else {
    const valueKind = str(fd, "valueKind") === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
    const value: AmountOffProductsConfig["value"] =
      valueKind === "PERCENTAGE"
        ? { kind: "PERCENTAGE", percent: num(str(fd, "percent")) }
        : {
            kind: "FIXED_AMOUNT",
            amountMinor: amount(str(fd, "amount"), "config.value.amount", "Enter an amount."),
            currencyCode: ctx.shopCurrency,
            appliesToEachItem: str(fd, "appliesTo") !== "once",
          };
    config = { type: "AMOUNT_OFF_PRODUCTS", target, value };
  }

  const startDate = str(fd, "startDate");
  const endDate = str(fd, "endDate");
  const draft: RuleDraft = {
    id: str(fd, "id") || undefined,
    title: str(fd, "title"),
    enabled: str(fd, "enabled") !== "false",
    priority: num(str(fd, "priority")),
    startsAt: startDate ? zonedDayToUtcIso(startDate, ctx.timezone, false) : "",
    endsAt: endDate ? zonedDayToUtcIso(endDate, ctx.timezone, true) : null,
    combinesWith: {
      orderDiscounts: fd.get("combinesOrder") !== null,
      productDiscounts: fd.get("combinesProduct") !== null,
      shippingDiscounts: fd.get("combinesShipping") !== null,
    },
    config,
  };
  return { draft, errors };
}

/** Values to pre-fill the form with (edit page). */
export function draftToFormValues(draft: RuleDraft, ctx: FormContext) {
  const c = draft.config;
  const money = (minor: number, currency: string) => formatMinor(minor, currencyExponent(currency));
  const v = c.type === "AMOUNT_OFF_PRODUCTS" ? c.value : null;
  const target = targetOf(c);
  const bogo = c.type === "BUY_X_GET_Y" ? c : null;
  const tiers =
    c.type === "TIERED_SPEND"
      ? c.tiers.map((t) => ({
          threshold: money(t.thresholdMinor, c.currencyCode),
          value: t.value.kind === "PERCENTAGE" ? String(t.value.percent) : money(t.value.amountMinor, c.currencyCode),
        }))
      : [
          { threshold: "", value: "" },
          { threshold: "", value: "" },
        ];
  return {
    id: draft.id ?? "",
    ruleType: c.type,
    title: draft.title,
    priority: String(draft.priority),
    valueKind: v ? v.kind : ("PERCENTAGE" as const),
    percent: v?.kind === "PERCENTAGE" ? String(v.percent) : "",
    amount: v?.kind === "FIXED_AMOUNT" ? money(v.amountMinor, v.currencyCode) : "",
    appliesTo: v?.kind === "FIXED_AMOUNT" && !v.appliesToEachItem ? ("once" as const) : ("each" as const),
    tierKind: c.type === "TIERED_SPEND" ? c.tiers[0]?.value.kind ?? "PERCENTAGE" : ("PERCENTAGE" as const),
    tiers,
    startDate: draft.startsAt ? utcIsoToZonedDay(draft.startsAt, ctx.timezone) : "",
    endDate: draft.endsAt ? utcIsoToZonedDay(draft.endsAt, ctx.timezone) : "",
    targetKind: target?.kind === "PRODUCTS" ? ("PRODUCTS" as const) : ("COLLECTIONS" as const),
    targetIds: target ? (target.kind === "PRODUCTS" ? [...target.productIds] : [...target.collectionIds]) : [],
    buyQuantity: bogo ? String(bogo.buyQuantity) : "2",
    getQuantity: bogo ? String(bogo.getQuantity) : "1",
    bogoPercent: bogo ? String(bogo.percent) : "100",
    limitPerOrder: bogo ? String(bogo.limitPerOrder) : "1",
    combinesOrder: draft.combinesWith.orderDiscounts,
    combinesProduct: draft.combinesWith.productDiscounts,
    combinesShipping: draft.combinesWith.shippingDiscounts,
  };
}

/** Map validation errors to form field names. */
export function errorsByFormField(errors: ValidationError[]): Record<string, string> {
  const map: Record<string, string> = {
    title: "title",
    priority: "priority",
    startsAt: "startDate",
    endsAt: "endDate",
    "config.target.collectionIds": "targetIds",
    "config.target.productIds": "targetIds",
    "config.buyQuantity": "buyQuantity",
    "config.getQuantity": "getQuantity",
    "config.percent": "bogoPercent",
    "config.limitPerOrder": "limitPerOrder",
    "config.value.percent": "percent",
    "config.value.amount": "amount",
    "config.value.currencyCode": "amount",
    "config.value.appliesToEachItem": "appliesTo",
    "config.value.kind": "valueKind",
    "config.type": "form",
    "config.tiers": "tiers",
    "config.currencyCode": "tiers",
    ruleType: "form",
    enabled: "form",
  };
  const out: Record<string, string> = {};
  for (const e of errors) {
    const tier = /^config\.tiers\.(\d+)\.(threshold|value)$/.exec(e.field);
    const key = tier ? `${tier[2] === "threshold" ? "tierThreshold" : "tierValue"}.${tier[1]}` : map[e.field] ?? "form";
    if (!out[key]) out[key] = e.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Timezone helpers (Intl only; no dependencies)
// ---------------------------------------------------------------------------

function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "2026-12-01" in the shop's timezone → UTC ISO at 00:00:00 (or 23:59:59 for end dates). */
export function zonedDayToUtcIso(day: string, timeZone: string, endOfDay: boolean): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return "";
  const wall = Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  let instant = wall - tzOffsetMs(wall, timeZone);
  const second = wall - tzOffsetMs(instant, timeZone);
  if (second !== instant) instant = second; // DST boundary
  return new Date(instant).toISOString();
}

/** UTC ISO → "YYYY-MM-DD" calendar day in the shop's timezone. */
export function utcIsoToZonedDay(iso: string, timeZone: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const local = new Date(t + tzOffsetMs(t, timeZone));
  return local.toISOString().slice(0, 10);
}
