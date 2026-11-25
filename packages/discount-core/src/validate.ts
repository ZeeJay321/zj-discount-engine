/**
 * Rule validation, shared by the admin form (client) and the route action (server).
 * Returns field-keyed errors; an empty array means the rule is valid.
 */
import { MAX_LINE_SUBTOTAL_MINOR } from "./rules/target";
import type { AmountOffProductsConfig, BuyXGetYConfig, ProductTarget, RuleDraft, TieredSpendConfig } from "./types";

export interface ValidationError {
  /** Dotted path into RuleDraft, e.g. "config.value.percent". */
  field: string;
  message: string;
}

export type OtherRule = Pick<RuleDraft, "id" | "title" | "enabled" | "priority" | "startsAt" | "endsAt">;

export const MAX_COLLECTIONS_PER_RULE = 50;
export const MAX_PRODUCTS_PER_RULE = 100;
export const MAX_BOGO_QUANTITY = 100;
export const MAX_BOGO_LIMIT_PER_ORDER = 100;
export const MIN_TIERS = 2;
export const MAX_TIERS = 5;
export const MAX_PRIORITY = 1000;
const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/\d+$/;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
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
  if (c && c.type === "AMOUNT_OFF_PRODUCTS") validateAmountOffProducts(c, add);
  else if (c && c.type === "TIERED_SPEND") validateTieredSpend(c, add);
  else if (c && c.type === "BUY_X_GET_Y") validateBuyXGetY(c, add);
  else add("config.type", "Unsupported rule type.");

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

type Add = (field: string, message: string) => void;

function validatePercent(field: string, percent: unknown, add: Add): boolean {
  if (typeof percent !== "number" || !Number.isFinite(percent)) add(field, "Enter a percentage.");
  else if (percent <= 0) add(field, "Percentage must be greater than 0.");
  else if (percent > 100) add(field, "Percentage cannot be more than 100.");
  else if (Math.abs(percent * 100 - Math.round(percent * 100)) > 1e-9) add(field, "Use at most 2 decimal places.");
  else return true;
  return false;
}

function validateAmountMinor(field: string, amountMinor: unknown, add: Add): boolean {
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor)) add(field, "Enter an amount.");
  else if (amountMinor <= 0) add(field, "Amount must be greater than 0.");
  else if (amountMinor > MAX_LINE_SUBTOTAL_MINOR) add(field, "Amount is too large.");
  else return true;
  return false;
}

/** Product set: 1–50 collections or 1–100 products, valid GIDs, no duplicates. */
function validateTarget(target: ProductTarget | undefined, add: Add) {
  if (target?.kind === "PRODUCTS") {
    const f = "config.target.productIds";
    const ids = Array.isArray(target.productIds) ? target.productIds : [];
    if (ids.length === 0) add(f, "Choose at least one product.");
    else if (ids.length > MAX_PRODUCTS_PER_RULE) add(f, `Choose at most ${MAX_PRODUCTS_PER_RULE} products.`);
    else if (ids.some((id) => !PRODUCT_GID.test(id))) add(f, "Product IDs must be Shopify product GIDs.");
    else if (new Set(ids).size !== ids.length) add(f, "Products are duplicated.");
    return;
  }
  const f = "config.target.collectionIds";
  const ids = target?.kind === "COLLECTIONS" && Array.isArray(target.collectionIds) ? target.collectionIds : [];
  if (ids.length === 0) add(f, "Choose at least one collection.");
  else if (ids.length > MAX_COLLECTIONS_PER_RULE) add(f, `Choose at most ${MAX_COLLECTIONS_PER_RULE} collections.`);
  else if (ids.some((id) => !COLLECTION_GID.test(id))) add(f, "Collection IDs must be Shopify collection GIDs.");
  else if (new Set(ids).size !== ids.length) add(f, "Collections are duplicated.");
}

function validateIntInRange(field: string, v: unknown, min: number, max: number, label: string, add: Add) {
  if (typeof v !== "number" || !Number.isInteger(v)) add(field, `Enter a whole number for ${label}.`);
  else if (v < min || v > max) add(field, `${label[0].toUpperCase()}${label.slice(1)} must be from ${min} to ${max}.`);
}

/** Buy X get Y: X, Y in 1–100; percent in (0, 100]; limit per order 1–100; a product set. */
function validateBuyXGetY(c: BuyXGetYConfig, add: Add) {
  validateTarget(c.target, add);
  validateIntInRange("config.buyQuantity", c.buyQuantity, 1, MAX_BOGO_QUANTITY, "the buy quantity", add);
  validateIntInRange("config.getQuantity", c.getQuantity, 1, MAX_BOGO_QUANTITY, "the get quantity", add);
  validatePercent("config.percent", c.percent, add);
  validateIntInRange("config.limitPerOrder", c.limitPerOrder, 1, MAX_BOGO_LIMIT_PER_ORDER, "the limit per order", add);
}

function validateAmountOffProducts(c: AmountOffProductsConfig, add: Add) {
  validateTarget(c.target, add);

  const v = c.value;
  if (v?.kind === "PERCENTAGE") {
    validatePercent("config.value.percent", v.percent, add);
  } else if (v?.kind === "FIXED_AMOUNT") {
    validateAmountMinor("config.value.amount", v.amountMinor, add);
    if (typeof v.currencyCode !== "string" || !CURRENCY.test(v.currencyCode))
      add("config.value.currencyCode", "Currency code is invalid.");
    if (typeof v.appliesToEachItem !== "boolean") add("config.value.appliesToEachItem", "Choose how the amount applies.");
  } else {
    add("config.value.kind", "Choose percentage or fixed amount.");
  }
}

/**
 * Tiered spend: 2–5 tiers; thresholds > 0 and strictly increasing; every tier uses the
 * same kind (so "never decreases" is well defined); values never decrease from one
 * tier to the next; a fixed discount can't exceed its own threshold.
 */
function validateTieredSpend(c: TieredSpendConfig, add: Add) {
  if (typeof c.currencyCode !== "string" || !CURRENCY.test(c.currencyCode)) add("config.currencyCode", "Currency code is invalid.");
  const tiers = Array.isArray(c.tiers) ? c.tiers : [];
  if (tiers.length < MIN_TIERS || tiers.length > MAX_TIERS) {
    add("config.tiers", `Add between ${MIN_TIERS} and ${MAX_TIERS} tiers.`);
    if (tiers.length === 0) return;
  }
  const kind = tiers[0]?.value?.kind;
  if (kind !== "PERCENTAGE" && kind !== "FIXED_AMOUNT") {
    add("config.tiers.0.value", "Choose percentage or fixed amount.");
    return;
  }
  let prevThreshold: number | null = null;
  let prevValue: number | null = null;
  tiers.forEach((t, i) => {
    const tf = `config.tiers.${i}.threshold`;
    const vf = `config.tiers.${i}.value`;
    let thresholdOk = false;
    if (typeof t?.thresholdMinor !== "number" || !Number.isSafeInteger(t.thresholdMinor)) add(tf, "Enter a spend amount.");
    else if (t.thresholdMinor <= 0) add(tf, "Spend amount must be greater than 0.");
    else if (t.thresholdMinor > MAX_LINE_SUBTOTAL_MINOR) add(tf, "Spend amount is too large.");
    else if (prevThreshold !== null && t.thresholdMinor <= prevThreshold) add(tf, "Each tier must need more spend than the one before.");
    else thresholdOk = true;
    if (typeof t?.thresholdMinor === "number" && Number.isSafeInteger(t.thresholdMinor) && t.thresholdMinor > 0) {
      prevThreshold = t.thresholdMinor;
    }

    const v = t?.value;
    if (!v || v.kind !== kind) {
      add(vf, "All tiers must use the same discount type.");
      return;
    }
    const n = v.kind === "PERCENTAGE" ? v.percent : v.amountMinor;
    const ok = v.kind === "PERCENTAGE" ? validatePercent(vf, v.percent, add) : validateAmountMinor(vf, v.amountMinor, add);
    if (!ok) return;
    if (v.kind === "FIXED_AMOUNT" && thresholdOk && v.amountMinor > t.thresholdMinor) {
      add(vf, "The discount can't be more than the spend amount for this tier.");
      return;
    }
    if (prevValue !== null && n < prevValue) add(vf, "A higher tier can't give a smaller discount than the tier before.");
    prevValue = n;
  });
}
