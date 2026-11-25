/**
 * The JSON stored in the discount's `$app` / `rule-config` metafield. The Function
 * reads it through its input query; `collectionIds` is top-level because the
 * extension's input variables are taken from this metafield's top-level keys.
 */
import { discountClassFor } from "./evaluate";
import type { AmountOffValue, DiscountClass, ProductTarget, RuleConfig, RuleDraft, SpendTier, TierValue } from "./types";

/**
 * v1: amount-off-products with collection targets.
 * v2: adds the TIERED_SPEND type (same top-level shape).
 * v3: adds BUY_X_GET_Y and PRODUCTS (product-list) targets.
 * Readers accept both; writers always write the current version. Discounts saved
 * with v1 keep working until they are next edited.
 */
export const RULE_CONFIG_SCHEMA_VERSION = 3;
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3];

/** Oldest schema version that can describe this config (older payloads can't contain it). */
export function minSchemaVersion(config: RuleConfig): number {
  if (config.type === "BUY_X_GET_Y") return 3;
  if (config.type === "AMOUNT_OFF_PRODUCTS" && config.target.kind === "PRODUCTS") return 3;
  if (config.type === "TIERED_SPEND") return 2;
  return 1;
}
export const METAFIELD_NAMESPACE = "$app";
export const METAFIELD_KEY = "rule-config";

export interface RuleMetafieldPayload {
  schemaVersion: number;
  ruleId: string;
  title: string;
  /** Input-query variable for `inAnyCollection(ids: $collectionIds)`. Always present. */
  collectionIds: string[];
  config: RuleConfig;
}

export function toMetafieldPayload(rule: { id: string; title: string; config: RuleConfig }): RuleMetafieldPayload {
  return {
    schemaVersion: RULE_CONFIG_SCHEMA_VERSION,
    ruleId: rule.id,
    title: rule.title,
    collectionIds: collectionIdsOf(rule.config),
    config: rule.config,
  };
}

/** The rule's product set, if it has one (amount-off and buy X get Y). */
export function targetOf(config: RuleConfig): ProductTarget | null {
  return config.type === "TIERED_SPEND" ? null : config.target;
}

export function collectionIdsOf(config: RuleConfig): string[] {
  const t = targetOf(config);
  return t && t.kind === "COLLECTIONS" ? [...t.collectionIds] : [];
}

export function productIdsOf(config: RuleConfig): string[] {
  const t = targetOf(config);
  return t && t.kind === "PRODUCTS" ? [...t.productIds] : [];
}

export function discountClassesFor(rule: Pick<RuleDraft, "config">): DiscountClass[] {
  return [discountClassFor(rule.config)];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Strict structural parse of the metafield JSON. Values are range-checked by validateRule on save. */
export function parseMetafieldPayload(json: unknown): ParseResult<RuleMetafieldPayload> {
  if (!isObj(json)) return { ok: false, error: "payload is not an object" };
  const version = json.schemaVersion;
  if (typeof version !== "number" || !SUPPORTED_SCHEMA_VERSIONS.includes(version)) return { ok: false, error: "unsupported schemaVersion" };
  if (typeof json.ruleId !== "string" || typeof json.title !== "string")
    return { ok: false, error: "ruleId/title missing" };
  if (!isStrArray(json.collectionIds)) return { ok: false, error: "collectionIds missing" };
  const config = parseConfig(json.config);
  if (!config.ok) return config;
  if (version < minSchemaVersion(config.value)) return { ok: false, error: `rule needs schemaVersion ${minSchemaVersion(config.value)}` };
  return {
    ok: true,
    value: {
      schemaVersion: version,
      ruleId: json.ruleId,
      title: json.title,
      collectionIds: json.collectionIds,
      config: config.value,
    },
  };
}

export function parseConfig(c: unknown): ParseResult<RuleConfig> {
  if (!isObj(c)) return { ok: false, error: "config is not an object" };
  if (c.type === "TIERED_SPEND") return parseTiered(c);
  if (c.type === "BUY_X_GET_Y") return parseBuyXGetY(c);
  if (c.type !== "AMOUNT_OFF_PRODUCTS") return { ok: false, error: "unknown rule type" };
  const target = parseTarget(c.target);
  if (!target.ok) return target;
  const value = parseValue(c.value);
  if (!value.ok) return value;
  return { ok: true, value: { type: "AMOUNT_OFF_PRODUCTS", target: target.value, value: value.value } };
}

function parseTarget(t: unknown): ParseResult<ProductTarget> {
  if (isObj(t) && t.kind === "COLLECTIONS" && isStrArray(t.collectionIds)) {
    return { ok: true, value: { kind: "COLLECTIONS", collectionIds: t.collectionIds } };
  }
  if (isObj(t) && t.kind === "PRODUCTS" && isStrArray(t.productIds)) {
    return { ok: true, value: { kind: "PRODUCTS", productIds: t.productIds } };
  }
  return { ok: false, error: "invalid target" };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseBuyXGetY(c: Record<string, unknown>): ParseResult<RuleConfig> {
  const target = parseTarget(c.target);
  if (!target.ok) return target;
  if (!isNum(c.buyQuantity) || !isNum(c.getQuantity) || !isNum(c.percent) || !isNum(c.limitPerOrder)) {
    return { ok: false, error: "invalid buy X get Y values" };
  }
  return {
    ok: true,
    value: {
      type: "BUY_X_GET_Y",
      target: target.value,
      buyQuantity: c.buyQuantity,
      getQuantity: c.getQuantity,
      percent: c.percent,
      limitPerOrder: c.limitPerOrder,
    },
  };
}

function parseValue(v: unknown): ParseResult<AmountOffValue> {
  if (!isObj(v)) return { ok: false, error: "invalid value" };
  if (v.kind === "PERCENTAGE" && typeof v.percent === "number" && Number.isFinite(v.percent)) {
    return { ok: true, value: { kind: "PERCENTAGE", percent: v.percent } };
  }
  if (
    v.kind === "FIXED_AMOUNT" &&
    typeof v.amountMinor === "number" &&
    Number.isSafeInteger(v.amountMinor) &&
    typeof v.currencyCode === "string" &&
    typeof v.appliesToEachItem === "boolean"
  ) {
    return {
      ok: true,
      value: {
        kind: "FIXED_AMOUNT",
        amountMinor: v.amountMinor,
        currencyCode: v.currencyCode,
        appliesToEachItem: v.appliesToEachItem,
      },
    };
  }
  return { ok: false, error: "invalid value" };
}

function parseTiered(c: Record<string, unknown>): ParseResult<RuleConfig> {
  if (typeof c.currencyCode !== "string") return { ok: false, error: "currencyCode missing" };
  if (!Array.isArray(c.tiers) || c.tiers.length === 0) return { ok: false, error: "tiers missing" };
  const tiers: SpendTier[] = [];
  for (let i = 0; i < c.tiers.length; i++) {
    const t: unknown = c.tiers[i];
    if (!isObj(t) || typeof t.thresholdMinor !== "number" || !Number.isSafeInteger(t.thresholdMinor))
      return { ok: false, error: "invalid tier threshold" };
    const v = t.value;
    let value: TierValue;
    if (isObj(v) && v.kind === "PERCENTAGE" && typeof v.percent === "number" && Number.isFinite(v.percent)) {
      value = { kind: "PERCENTAGE", percent: v.percent };
    } else if (isObj(v) && v.kind === "FIXED_AMOUNT" && typeof v.amountMinor === "number" && Number.isSafeInteger(v.amountMinor)) {
      value = { kind: "FIXED_AMOUNT", amountMinor: v.amountMinor };
    } else {
      return { ok: false, error: "invalid tier value" };
    }
    tiers.push({ thresholdMinor: t.thresholdMinor, value });
  }
  return { ok: true, value: { type: "TIERED_SPEND", currencyCode: c.currencyCode, tiers } };
}
