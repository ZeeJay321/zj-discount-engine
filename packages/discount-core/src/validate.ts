/**
 * Rule validation, shared by the admin form (client) and the route action (server).
 * Returns field-keyed errors; an empty array means the rule is valid.
 */
import { MAX_LINE_SUBTOTAL_MINOR } from "./rules/amountOffProducts";
import type { RuleDraft } from "./types";

export interface ValidationError {
  /** Dotted path into RuleDraft, e.g. "config.value.percent". */
  field: string;
  message: string;
}

export type OtherRule = Pick<RuleDraft, "id" | "title" | "enabled" | "priority" | "startsAt" | "endsAt">;

export const MAX_COLLECTIONS_PER_RULE = 50;
export const MAX_PRIORITY = 1000;
const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/\d+$/;
const CURRENCY = /^[A-Z]{3}$/;

export function validateRule(draft: RuleDraft, others: readonly OtherRule[] = []): ValidationError[] {
  const errors: ValidationError[] = [];
  const add = (field: string, message: string) => errors.push({ field, message });

  // Basics
  const title = typeof draft.title === "string" ? draft.title.trim() : "";
  if (!title) add("title", "Title is required.");
  else if (title.length > 255) add("title", "Title must be 255 characters or fewer.");

  if (!Number.isInteger(draft.priority) || draft.priority < 0 || draft.priority > MAX_PRIORITY)
    add("priority", `Priority must be a whole number from 0 to ${MAX_PRIORITY}.`);

  // Dates
  const start = Date.parse(draft.startsAt);
  const end = draft.endsAt === null ? null : Date.parse(draft.endsAt);
  if (Number.isNaN(start)) add("startsAt", "Start date is required.");
  if (end !== null && Number.isNaN(end)) add("endsAt", "End date is not a valid date.");
  else if (end !== null && !Number.isNaN(start) && end <= start)
    add("endsAt", "End date must be after the start date.");

  // Config
  const c = draft.config;
  if (!c || c.type !== "AMOUNT_OFF_PRODUCTS") {
    add("config.type", "Unsupported rule type.");
  } else {
    const ids = c.target?.collectionIds ?? [];
    if (ids.length === 0) add("config.target.collectionIds", "Choose at least one collection.");
    else if (ids.length > MAX_COLLECTIONS_PER_RULE)
      add("config.target.collectionIds", `Choose at most ${MAX_COLLECTIONS_PER_RULE} collections.`);
    else if (ids.some((id) => !COLLECTION_GID.test(id)))
      add("config.target.collectionIds", "Collection IDs must be Shopify collection GIDs.");
    else if (new Set(ids).size !== ids.length) add("config.target.collectionIds", "Collections are duplicated.");

    const v = c.value;
    if (v?.kind === "PERCENTAGE") {
      if (typeof v.percent !== "number" || !Number.isFinite(v.percent)) add("config.value.percent", "Enter a percentage.");
      else if (v.percent <= 0) add("config.value.percent", "Percentage must be greater than 0.");
      else if (v.percent > 100) add("config.value.percent", "Percentage cannot be more than 100.");
      else if (Math.abs(v.percent * 100 - Math.round(v.percent * 100)) > 1e-9)
        add("config.value.percent", "Use at most 2 decimal places.");
    } else if (v?.kind === "FIXED_AMOUNT") {
      if (!Number.isSafeInteger(v.amountMinor)) add("config.value.amount", "Enter an amount.");
      else if (v.amountMinor <= 0) add("config.value.amount", "Amount must be greater than 0.");
      else if (v.amountMinor > MAX_LINE_SUBTOTAL_MINOR) add("config.value.amount", "Amount is too large.");
      if (typeof v.currencyCode !== "string" || !CURRENCY.test(v.currencyCode))
        add("config.value.currencyCode", "Currency code is invalid.");
      if (typeof v.appliesToEachItem !== "boolean") add("config.value.appliesToEachItem", "Choose how the amount applies.");
    } else {
      add("config.value.kind", "Choose percentage or fixed amount.");
    }
  }

  // Overlap: two enabled rules with the same priority whose date ranges intersect.
  if (draft.enabled && errors.every((e) => !e.field.startsWith("startsAt") && !e.field.startsWith("endsAt") && e.field !== "priority")) {
    for (const o of others) {
      if (!o.enabled || o.priority !== draft.priority) continue;
      if (draft.id !== undefined && o.id === draft.id) continue;
      if (rangesOverlap(start, end, Date.parse(o.startsAt), o.endsAt === null ? null : Date.parse(o.endsAt))) {
        add("priority", `Overlaps "${o.title}", which has the same priority (${o.priority}) during these dates. Change the priority or the dates.`);
        break;
      }
    }
  }

  return errors;
}

/** Half-open intervals [start, end); null end = open-ended. */
export function rangesOverlap(aStart: number, aEnd: number | null, bStart: number, bEnd: number | null): boolean {
  const aEndsAfterBStarts = aEnd === null || aEnd > bStart;
  const bEndsAfterAStarts = bEnd === null || bEnd > aStart;
  return aEndsAfterBStarts && bEndsAfterAStarts;
}
