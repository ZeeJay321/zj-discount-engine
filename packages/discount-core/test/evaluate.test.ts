import { describe, expect, it } from "vitest";
import { discountClassFor, evaluateRule, isActiveAt, type EvaluableRule } from "../src";
import { pct, rule } from "./helpers";

describe("evaluateRule dispatch", () => {
  it("throws on an unknown rule type", () => {
    const bad = { ruleId: "x", title: "x", config: { type: "NOPE" } } as unknown as EvaluableRule;
    expect(() => evaluateRule(bad, { currencyCode: "USD", lines: [] }, { presentmentCurrencyRate: 1 })).toThrow(/Unsupported/);
  });
  it("maps amount-off-products to the PRODUCT class", () => {
    expect(discountClassFor(rule(pct(10)).config)).toBe("PRODUCT");
  });
});

describe("isActiveAt (simulator only)", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const base = { enabled: true, startsAt: "2026-11-01T00:00:00Z", endsAt: null as string | null };
  it("active when started and open-ended", () => expect(isActiveAt(base, now)).toBe(true));
  it("inactive when disabled", () => expect(isActiveAt({ ...base, enabled: false }, now)).toBe(false));
  it("inactive before start", () => expect(isActiveAt({ ...base, startsAt: "2026-12-02T00:00:00Z" }, now)).toBe(false));
  it("inactive at or after end", () => {
    expect(isActiveAt({ ...base, endsAt: "2026-12-01T12:00:00Z" }, now)).toBe(false);
    expect(isActiveAt({ ...base, endsAt: "2026-12-01T12:00:01Z" }, now)).toBe(true);
  });
});
