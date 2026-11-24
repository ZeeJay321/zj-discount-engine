import { describe, expect, it } from "vitest";
import { discountClassesFor, parseConfig, parseMetafieldPayload, toMetafieldPayload } from "../src";
import { C100, C200, fixed, pct, rule } from "./helpers";

describe("metafield payload", () => {
  it("puts collectionIds at the top level for input variables and round-trips", () => {
    const r = rule(pct(10), [C100, C200]);
    const payload = toMetafieldPayload({ id: "rule_1", title: "Ten off", config: r.config });
    expect(payload.collectionIds).toEqual([C100, C200]);
    expect(payload.schemaVersion).toBe(1);
    const parsed = parseMetafieldPayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed).toEqual({ ok: true, value: payload });
  });

  it("round-trips a fixed amount config", () => {
    const payload = toMetafieldPayload({ id: "r", title: "t", config: rule(fixed(500, true)).config });
    expect(parseMetafieldPayload(payload)).toEqual({ ok: true, value: payload });
  });

  it("copies collectionIds rather than sharing the array", () => {
    const cfg = rule(pct(10)).config;
    const payload = toMetafieldPayload({ id: "r", title: "t", config: cfg });
    payload.collectionIds.push("x");
    expect(cfg.target.collectionIds).toEqual([C100]);
  });

  it("reports discount classes", () => expect(discountClassesFor({ config: rule(pct(1)).config })).toEqual(["PRODUCT"]));

  const good = toMetafieldPayload({ id: "r", title: "t", config: rule(pct(10)).config });
  it.each([
    ["null", null],
    ["array", []],
    ["wrong version", { ...good, schemaVersion: 2 }],
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
