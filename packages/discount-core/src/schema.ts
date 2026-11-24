/**
 * The JSON stored in the discount's `$app` / `rule-config` metafield. The Function
 * reads it through its input query; `collectionIds` is top-level because the
 * extension's input variables are taken from this metafield's top-level keys.
 */
import { discountClassFor } from "./evaluate";
import type { AmountOffValue, DiscountClass, RuleConfig, RuleDraft } from "./types";

export const RULE_CONFIG_SCHEMA_VERSION = 1;
export const METAFIELD_NAMESPACE = "$app";
export const METAFIELD_KEY = "rule-config";

export interface RuleMetafieldPayload {
  schemaVersion: typeof RULE_CONFIG_SCHEMA_VERSION;
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
  return config.target.kind === "COLLECTIONS" ? [...config.target.collectionIds] : [];
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
  if (json.schemaVersion !== RULE_CONFIG_SCHEMA_VERSION) return { ok: false, error: "unsupported schemaVersion" };
  if (typeof json.ruleId !== "string" || typeof json.title !== "string")
    return { ok: false, error: "ruleId/title missing" };
  if (!isStrArray(json.collectionIds)) return { ok: false, error: "collectionIds missing" };
  const config = parseConfig(json.config);
  if (!config.ok) return config;
  return {
    ok: true,
    value: {
      schemaVersion: RULE_CONFIG_SCHEMA_VERSION,
      ruleId: json.ruleId,
      title: json.title,
      collectionIds: json.collectionIds,
      config: config.value,
    },
  };
}

export function parseConfig(c: unknown): ParseResult<RuleConfig> {
  if (!isObj(c)) return { ok: false, error: "config is not an object" };
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
