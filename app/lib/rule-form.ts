/**
 * Rule form ⇄ RuleDraft conversion. Shared by the browser (pre-submit validation)
 * and the route action (authoritative validation), so both see the same draft.
 * Dates are entered as shop-local calendar days and stored as UTC instants.
 */
import {
  currencyExponent,
  formatMinor,
  parseDecimalToMinor,
  type RuleConfig,
  type RuleDraft,
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
  const valueKind = str(fd, "valueKind") === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
  const collectionIds = fd
    .getAll("collectionIds")
    .filter((v): v is string => typeof v === "string" && v !== "");

  let value: RuleConfig["value"];
  if (valueKind === "PERCENTAGE") {
    value = { kind: "PERCENTAGE", percent: num(str(fd, "percent")) };
  } else {
    let amountMinor = Number.NaN;
    const raw = str(fd, "amount");
    try {
      amountMinor = parseDecimalToMinor(raw, currencyExponent(ctx.shopCurrency));
    } catch {
      errors.push({ field: "config.value.amount", message: raw ? "Enter a valid amount, e.g. 5.00." : "Enter an amount." });
    }
    value = {
      kind: "FIXED_AMOUNT",
      amountMinor,
      currencyCode: ctx.shopCurrency,
      appliesToEachItem: str(fd, "appliesTo") !== "once",
    };
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
    config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds }, value },
  };
  return { draft, errors };
}

/** Values to pre-fill the form with (edit page). */
export function draftToFormValues(draft: RuleDraft, ctx: FormContext) {
  const v = draft.config.value;
  return {
    id: draft.id ?? "",
    title: draft.title,
    priority: String(draft.priority),
    valueKind: v.kind,
    percent: v.kind === "PERCENTAGE" ? String(v.percent) : "",
    amount: v.kind === "FIXED_AMOUNT" ? formatMinor(v.amountMinor, currencyExponent(v.currencyCode)) : "",
    appliesTo: v.kind === "FIXED_AMOUNT" && !v.appliesToEachItem ? "once" : "each",
    startDate: draft.startsAt ? utcIsoToZonedDay(draft.startsAt, ctx.timezone) : "",
    endDate: draft.endsAt ? utcIsoToZonedDay(draft.endsAt, ctx.timezone) : "",
    collectionIds: draft.config.target.collectionIds,
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
    "config.target.collectionIds": "collectionIds",
    "config.value.percent": "percent",
    "config.value.amount": "amount",
    "config.value.currencyCode": "amount",
    "config.value.appliesToEachItem": "appliesTo",
    "config.value.kind": "valueKind",
    "config.type": "valueKind",
    enabled: "form",
  };
  const out: Record<string, string> = {};
  for (const e of errors) {
    const key = map[e.field] ?? "form";
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
