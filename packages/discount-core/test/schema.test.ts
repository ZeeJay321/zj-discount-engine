import { describe, expect, it } from "vitest";
import { discountClassesFor, parseConfig, parseMetafieldPayload, toMetafieldPayload, type AmountOffProductsConfig } from "../src";
import { C100, C200, fixed, pct, rule } from "./helpers";

describe("metafield payload", () => {
  it("puts collectionIds at the top level for input variables and round-trips", () => {
    const r = rule(pct(10), [C100, C200]);
    const payload = toMetafieldPayload({ id: "rule_1", title: "Ten off", config: r.config });
    expect(payload.collectionIds).toEqual([C100, C200]);
    expect(payload.schemaVersion).toBe(2);
    expect(payload.includeLines).toBe(true);
    const parsed = parseMetafieldPayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed).toEqual({ ok: true, value: payload });
  });

  it("round-trips a fixed amount config", () => {
    const payload = toMetafieldPayload({ id: "r", title: "t", config: rule(fixed(500, true)).config });
    expect(parseMetafieldPayload(payload)).toEqual({ ok: true, value: payload });
  });

  it("copies collectionIds rather than sharing the array", () => {
    const cfg = rule(pct(10)).config as AmountOffProductsConfig;
    const payload = toMetafieldPayload({ id: "r", title: "t", config: cfg });
    payload.collectionIds.push("x");
    expect(cfg.target.collectionIds).toEqual([C100]);
  });

  it("reports discount classes", () => expect(discountClassesFor({ config: rule(pct(1)).config })).toEqual(["PRODUCT"]));

  const good = toMetafieldPayload({ id: "r", title: "t", config: rule(pct(10)).config });
  it.each([
    ["null", null],
    ["array", []],
    ["unknown version", { ...good, schemaVersion: 3 }],
    ["v2 without includeLines", { ...good, includeLines: undefined }],
    ["missing ruleId", { ...good, ruleId: undefined }],
    ["missing title", { ...good, title: 5 }],
    ["missing collectionIds", { ...good, collectionIds: "x" }],
    ["config not object", { ...good, config: "x" }],
    ["unknown type", { ...good, config: { ...good.config, type: "BOGO" } }],
    ["bad target", { ...good, config: { ...good.config, target: { kind: "PRODUCTS", productIds: [] } } }],
    ["bad target ids", { ...good, config: { ...good.config, target: { kind: "COLLECTIONS", collectionIds: [1] } } }],
    ["value missing", { ...good, config: { ...good.config, value: null } }],
    ["percent NaN-ish", { ...good, config: { ...good.config, value: { kind: "PERCENTAGE", percent: "10" } } }],
    ["fixed missing currency", { ...good, config: { ...good.config, value: { kind: "FIXED_AMOUNT", amountMinor: 5, appliesToEachItem: true } } }],
    ["fixed float amount", { ...good, config: { ...good.config, value: { kind: "FIXED_AMOUNT", amountMinor: 5.5, currencyCode: "USD", appliesToEachItem: true } } }],
  ])("rejects %s", (_name, json) => {
    expect(parseMetafieldPayload(json).ok).toBe(false);
  });

  it("parseConfig rejects non-objects", () => expect(parseConfig(undefined).ok).toBe(false));
});

describe("schema versions", () => {
  const v1 = {
    schemaVersion: 1,
    ruleId: "old",
    title: "Old rule",
    collectionIds: [C100],
    config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds: [C100] }, value: { kind: "PERCENTAGE", percent: 10 } },
  };
  it("still reads v1 payloads (discounts saved before tiered spend existed)", () => {
    const r = parseMetafieldPayload(v1);
    expect(r.ok && r.value).toMatchObject({ schemaVersion: 1, ruleId: "old", includeLines: true });
  });
  it("rejects a tiered config inside a v1 payload", () => {
    const tiered = { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 100, value: { kind: "PERCENTAGE", percent: 5 } }] };
    expect(parseMetafieldPayload({ ...v1, config: tiered }).ok).toBe(false);
  });
  it("writes v2 with includeLines=false and no collections for tiered spend", () => {
    const config = {
      type: "TIERED_SPEND" as const,
      currencyCode: "USD",
      tiers: [
        { thresholdMinor: 10000, value: { kind: "PERCENTAGE" as const, percent: 10 } },
        { thresholdMinor: 20000, value: { kind: "PERCENTAGE" as const, percent: 15 } },
      ],
    };
    const payload = toMetafieldPayload({ id: "t", title: "Tiers", config });
    expect(payload).toMatchObject({ schemaVersion: 2, includeLines: false, collectionIds: [] });
    expect(parseMetafieldPayload(JSON.parse(JSON.stringify(payload)))).toEqual({ ok: true, value: payload });
    expect(discountClassesFor({ config })).toEqual(["ORDER"]);
  });
  it("round-trips fixed-amount tiers", () => {
    const config = {
      type: "TIERED_SPEND" as const,
      currencyCode: "JPY",
      tiers: [
        { thresholdMinor: 5000, value: { kind: "FIXED_AMOUNT" as const, amountMinor: 500 } },
        { thresholdMinor: 10000, value: { kind: "FIXED_AMOUNT" as const, amountMinor: 1500 } },
      ],
    };
    const payload = toMetafieldPayload({ id: "t", title: "Tiers", config });
    expect(parseMetafieldPayload(payload)).toEqual({ ok: true, value: payload });
  });
  const tieredPayload = (config: unknown) => ({ schemaVersion: 2, ruleId: "t", title: "t", collectionIds: [], includeLines: false, config });
  it.each([
    ["no currency", { type: "TIERED_SPEND", tiers: [{ thresholdMinor: 1, value: { kind: "PERCENTAGE", percent: 1 } }] }],
    ["no tiers", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [] }],
    ["tiers not array", { type: "TIERED_SPEND", currencyCode: "USD", tiers: "x" }],
    ["bad threshold", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 1.5, value: { kind: "PERCENTAGE", percent: 1 } }] }],
    ["tier not object", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [null] }],
    ["bad value", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 1, value: { kind: "PERCENTAGE", percent: "1" } }] }],
    ["bad fixed", { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 1, value: { kind: "FIXED_AMOUNT", amountMinor: 1.2 } }] }],
  ])("rejects tiered config with %s", (_n, config) => {
    expect(parseMetafieldPayload(tieredPayload(config)).ok).toBe(false);
  });
});
