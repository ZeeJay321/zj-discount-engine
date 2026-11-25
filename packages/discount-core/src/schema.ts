/**
 * The JSON stored in the discount's `$app` / `rule-config` metafield. The Function
 * reads it through its input query; `collectionIds` is top-level because the
 * extension's input variables are taken from this metafield's top-level keys.
 */
import { discountClassFor } from "./evaluate";
import type { AmountOffValue, DiscountClass, RuleConfig, RuleDraft, SpendTier, TierValue } from "./types";

/**
 * v1: amount-off-products only.
 * v2: adds the TIERED_SPEND type (same top-level shape).
 * Readers accept both; writers always write the current version. Discounts saved
 * with v1 keep working until they are next edited.
 */
export const RULE_CONFIG_SCHEMA_VERSION = 2;
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2];
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

export function collectionIdsOf(config: RuleConfig): string[] {
  return config.type === "AMOUNT_OFF_PRODUCTS" && config.target.kind === "COLLECTIONS" ? [...config.target.collectionIds] : [];
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
  if (version === 1 && config.value.type !== "AMOUNT_OFF_PRODUCTS") return { ok: false, error: "rule type needs schemaVersion 2" };
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
  if (c.type !== "AMOUNT_OFF_PRODUCTS") return { ok: false, error: "unknown rule type" };
  const t = c.target;
  if (!isObj(t) || t.kind !== "COLLECTIONS" || !isStrArray(t.collectionIds))
    return { ok: false, error: "invalid target" };
  const value = parseValue(c.value);
  if (!value.ok) return value;
  return {
    ok: true,
    value: {
      type: "AMOUNT_OFF_PRODUCTS",
      target: { kind: "COLLECTIONS", collectionIds: t.collectionIds },
      value: value.value,
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
