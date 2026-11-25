import { describe, expect, it } from "vitest";
import { rangesOverlap, validateRule, type OtherRule, type RuleDraft } from "../src";
import { C100, fixed, pct } from "./helpers";

function draft(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return {
    title: "Winter sale",
    enabled: true,
    priority: 10,
    startsAt: "2026-12-01T00:00:00.000Z",
    endsAt: "2026-12-31T23:59:59.000Z",
    combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
    config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds: [C100] }, value: pct(10) },
    ...overrides,
  };
}
const fields = (d: RuleDraft, others: OtherRule[] = []) => validateRule(d, others).map((e) => e.field);
const withValue = (value: unknown) =>
  draft({ config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds: [C100] }, value } as RuleDraft["config"] });
const withCollections = (collectionIds: string[]) =>
  draft({ config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds }, value: pct(10) } });

describe("validateRule", () => {
  it("accepts a valid percentage rule", () => expect(validateRule(draft())).toEqual([]));
  it("accepts a valid fixed rule and an open-ended rule", () => {
    expect(validateRule(withValue(fixed(500, true)))).toEqual([]);
    expect(validateRule(draft({ endsAt: null }))).toEqual([]);
  });

  it.each([
    ["empty title", { title: "  " }, "title"],
    ["long title", { title: "x".repeat(256) }, "title"],
    ["negative priority", { priority: -1 }, "priority"],
    ["fractional priority", { priority: 1.5 }, "priority"],
    ["huge priority", { priority: 1001 }, "priority"],
    ["missing start", { startsAt: "" }, "startsAt"],
    ["bad end", { endsAt: "nope" }, "endsAt"],
    ["end before start", { endsAt: "2026-11-30T00:00:00.000Z" }, "endsAt"],
    ["end equals start", { endsAt: "2026-12-01T00:00:00.000Z" }, "endsAt"],
  ])("rejects %s", (_n, o, field) => expect(fields(draft(o as Partial<RuleDraft>))).toContain(field));

  it.each([
    ["zero percent", pct(0)],
    ["negative percent", pct(-5)],
    ["percent above 100", pct(100.01)],
    ["three-decimal percent", pct(10.125)],
    ["NaN percent", pct(Number.NaN)],
  ])("rejects %s", (_n, v) => expect(fields(withValue(v))).toContain("config.value.percent"));

  it("accepts exactly 100% and two-decimal percent", () => {
    expect(validateRule(withValue(pct(100)))).toEqual([]);
    expect(validateRule(withValue(pct(12.34)))).toEqual([]);
  });

  it.each([
    ["zero amount", fixed(0, true), "config.value.amount"],
    ["negative amount", fixed(-100, true), "config.value.amount"],
    ["fractional minor units", fixed(1.5, true), "config.value.amount"],
    ["absurd amount", fixed(1e12, true), "config.value.amount"],
    ["bad currency", fixed(100, true, "usd"), "config.value.currencyCode"],
    ["missing appliesToEachItem", { kind: "FIXED_AMOUNT", amountMinor: 100, currencyCode: "USD" }, "config.value.appliesToEachItem"],
    ["no value kind", { kind: "BOGUS" }, "config.value.kind"],
  ])("rejects %s", (_n, v, field) => expect(fields(withValue(v))).toContain(field));

  it("rejects an unsupported type", () => {
    expect(fields(draft({ config: { type: "BOGO" } as unknown as RuleDraft["config"] }))).toContain("config.type");
  });

  it.each([
    ["no collections", []],
    ["too many collections", Array.from({ length: 51 }, (_, i) => `gid://shopify/Collection/${i}`)],
    ["non-GID collection", ["123"]],
    ["duplicate collections", [C100, C100]],
  ])("rejects %s", (_n, ids) => expect(fields(withCollections(ids))).toContain("config.target.collectionIds"));

  describe("overlap with same priority", () => {
    const other: OtherRule = {
      id: "other",
      title: "Black Friday",
      enabled: true,
      priority: 10,
      startsAt: "2026-12-15T00:00:00.000Z",
      endsAt: null,
    };
    it("rejects overlapping dates at the same priority", () => {
      const errs = validateRule(draft(), [other]);
      expect(errs).toHaveLength(1);
      expect(errs[0].field).toBe("priority");
      expect(errs[0].message).toContain("Black Friday");
    });
    it("allows different priority", () => expect(fields(draft({ priority: 11 }), [other])).toEqual([]));
    it("allows non-overlapping dates", () =>
      expect(fields(draft({ endsAt: "2026-12-15T00:00:00.000Z" }), [other])).toEqual([]));
    it("ignores disabled rules on either side", () => {
      expect(fields(draft(), [{ ...other, enabled: false }])).toEqual([]);
      expect(fields(draft({ enabled: false }), [other])).toEqual([]);
    });
    it("ignores itself when editing", () => expect(fields(draft({ id: "other" }), [other])).toEqual([]));
    it("detects overlap with open-ended draft", () =>
      expect(fields(draft({ endsAt: null, startsAt: "2027-01-01T00:00:00.000Z" }), [other])).toContain("priority"));
    it("skips the overlap check when dates are already invalid", () =>
      expect(fields(draft({ endsAt: "2026-11-01T00:00:00.000Z" }), [other])).toEqual(["endsAt"]));
  });
});

describe("rangesOverlap", () => {
  it.each([
    [0, 10, 10, 20, false],
    [0, 11, 10, 20, true],
    [0, null, 100, 200, true],
    [300, null, 100, 200, false],
    [0, 10, 5, null, true],
    [20, 30, 0, null, true],
  ])("[%d,%s) vs [%d,%s) → %s", (a, b, c, d, out) => expect(rangesOverlap(a, b, c, d)).toBe(out));
});

describe("validateRule — tiered spend", () => {
  const P = (percent: number) => ({ kind: "PERCENTAGE" as const, percent });
  const F = (amountMinor: number) => ({ kind: "FIXED_AMOUNT" as const, amountMinor });
  const tieredDraft = (tiers: Array<[number, ReturnType<typeof P> | ReturnType<typeof F>]>, currencyCode = "USD") =>
    draft({ config: { type: "TIERED_SPEND", currencyCode, tiers: tiers.map(([thresholdMinor, value]) => ({ thresholdMinor, value })) } });
  const f = (d: RuleDraft) => validateRule(d).map((e) => e.field);

  it("accepts 2–5 increasing tiers with non-decreasing values", () => {
    expect(validateRule(tieredDraft([[10000, P(10)], [20000, P(15)], [30000, P(20)]]))).toEqual([]);
    expect(validateRule(tieredDraft([[10000, P(10)], [20000, P(10)]]))).toEqual([]);
    expect(validateRule(tieredDraft([[5000, F(500)], [10000, F(1500)]]))).toEqual([]);
    expect(validateRule(tieredDraft([[1, P(1)], [2, P(2)], [3, P(3)], [4, P(4)], [5, P(100)]]))).toEqual([]);
  });

  it.each([
    ["one tier", [[10000, P(10)]], "config.tiers"],
    ["six tiers", [[1, P(1)], [2, P(2)], [3, P(3)], [4, P(4)], [5, P(5)], [6, P(6)]], "config.tiers"],
    ["equal thresholds", [[10000, P(10)], [10000, P(15)]], "config.tiers.1.threshold"],
    ["decreasing thresholds", [[20000, P(10)], [10000, P(15)]], "config.tiers.1.threshold"],
    ["zero threshold", [[0, P(10)], [10000, P(15)]], "config.tiers.0.threshold"],
    ["negative threshold", [[-1, P(10)], [10000, P(15)]], "config.tiers.0.threshold"],
    ["fractional threshold", [[1.5, P(10)], [10000, P(15)]], "config.tiers.0.threshold"],
    ["huge threshold", [[1, P(10)], [1e12, P(15)]], "config.tiers.1.threshold"],
    ["decreasing percent", [[10000, P(15)], [20000, P(10)]], "config.tiers.1.value"],
    ["percent above 100", [[10000, P(10)], [20000, P(101)]], "config.tiers.1.value"],
    ["zero percent", [[10000, P(0)], [20000, P(10)]], "config.tiers.0.value"],
    ["three-decimal percent", [[10000, P(10.125)], [20000, P(11)]], "config.tiers.0.value"],
    ["decreasing fixed", [[5000, F(1500)], [10000, F(500)]], "config.tiers.1.value"],
    ["zero fixed", [[5000, F(0)], [10000, F(500)]], "config.tiers.0.value"],
    ["fixed above its threshold", [[5000, F(6000)], [10000, F(7000)]], "config.tiers.0.value"],
    ["mixed kinds", [[5000, P(10)], [10000, F(500)]], "config.tiers.1.value"],
  ])("rejects %s", (_n, tiers, field) => {
    expect(f(tieredDraft(tiers as Array<[number, ReturnType<typeof P>]>))).toContain(field);
  });

  it("rejects an invalid currency, empty tiers and an unknown value kind", () => {
    expect(f(tieredDraft([[1, P(1)], [2, P(2)]], "usd"))).toContain("config.currencyCode");
    expect(f(draft({ config: { type: "TIERED_SPEND", currencyCode: "USD", tiers: [] } }))).toContain("config.tiers");
    expect(f(draft({ config: { type: "TIERED_SPEND", currencyCode: "USD", tiers: [{ thresholdMinor: 1, value: { kind: "X" } }, { thresholdMinor: 2, value: { kind: "X" } }] } as unknown as RuleDraft["config"] }))).toContain("config.tiers.0.value");
  });

  it("still applies the same-priority overlap check", () => {
    const other = { id: "o", title: "Other", enabled: true, priority: 10, startsAt: "2026-12-01T00:00:00.000Z", endsAt: null };
    expect(validateRule(tieredDraft([[1, P(1)], [2, P(2)]]), [other]).map((e) => e.field)).toContain("priority");
  });
});
