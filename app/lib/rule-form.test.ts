import { describe, expect, it } from "vitest";
import { validateRule, type AmountOffProductsConfig } from "@zj/discount-core";
import { describeTiers, describeValue } from "./rule-display";
import { draftToFormValues, errorsByFormField, parseRuleForm, utcIsoToZonedDay, zonedDayToUtcIso } from "./rule-form";

const ctx = { shopCurrency: "USD", timezone: "America/New_York" };
function fd(entries: Array<[string, string]>) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
const base: Array<[string, string]> = [
  ["title", " Winter sale "],
  ["priority", "3"],
  ["collectionIds", "gid://shopify/Collection/1"],
  ["collectionIds", "gid://shopify/Collection/2"],
  ["valueKind", "PERCENTAGE"],
  ["percent", "12.5"],
  ["startDate", "2026-12-01"],
  ["endDate", "2026-12-31"],
  ["combinesShipping", "on"],
];

describe("parseRuleForm", () => {
  it("builds a valid percentage draft with shop-timezone dates", () => {
    const { draft, errors } = parseRuleForm(fd(base), ctx);
    expect(errors).toEqual([]);
    expect(draft).toMatchObject({
      title: "Winter sale",
      enabled: true,
      priority: 3,
      startsAt: "2026-12-01T05:00:00.000Z",
      endsAt: "2027-01-01T04:59:59.000Z",
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
      config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds: ["gid://shopify/Collection/1", "gid://shopify/Collection/2"] }, value: { kind: "PERCENTAGE", percent: 12.5 } },
    });
    expect(validateRule(draft)).toEqual([]);
  });

  it("builds a fixed-amount draft in shop currency minor units", () => {
    const entries = base.filter(([k]) => k !== "valueKind" && k !== "percent");
    const { draft, errors } = parseRuleForm(fd([...entries, ["valueKind", "FIXED_AMOUNT"], ["amount", "5.5"], ["appliesTo", "once"]]), { shopCurrency: "JPY", timezone: "UTC" });
    expect(errors).toEqual([]);
    expect((draft.config as AmountOffProductsConfig).value).toEqual({ kind: "FIXED_AMOUNT", amountMinor: 6, currencyCode: "JPY", appliesToEachItem: false });
  });

  it("reports an unparseable amount, and empty fields fail validation", () => {
    const { errors } = parseRuleForm(fd([["valueKind", "FIXED_AMOUNT"], ["amount", "five"]]), ctx);
    expect(errors[0]).toMatchObject({ field: "config.value.amount" });
    expect(parseRuleForm(fd([["valueKind", "FIXED_AMOUNT"]]), ctx).errors[0].message).toBe("Enter an amount.");
    const { draft } = parseRuleForm(fd([]), ctx);
    const fields = validateRule(draft).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["title", "priority", "startsAt", "config.target.collectionIds", "config.value.percent"]));
    expect(draft.endsAt).toBeNull();
  });

  it("round-trips through draftToFormValues", () => {
    const { draft } = parseRuleForm(fd([...base, ["id", "rule_9"]]), ctx);
    const v = draftToFormValues(draft, ctx);
    expect(v).toMatchObject({ id: "rule_9", title: "Winter sale", priority: "3", percent: "12.5", startDate: "2026-12-01", endDate: "2026-12-31", combinesShipping: true, combinesOrder: false });
    const baseCfg = draft.config as AmountOffProductsConfig;
    const fixed = draftToFormValues({ ...draft, config: { ...baseCfg, value: { kind: "FIXED_AMOUNT", amountMinor: 550, currencyCode: "USD", appliesToEachItem: false } } }, ctx);
    expect(fixed).toMatchObject({ amount: "5.50", appliesTo: "once", valueKind: "FIXED_AMOUNT" });
  });

  it("maps validation errors to form fields (first message wins)", () => {
    expect(errorsByFormField([
      { field: "config.value.percent", message: "a" },
      { field: "config.value.percent", message: "b" },
      { field: "endsAt", message: "c" },
      { field: "mystery", message: "d" },
    ])).toEqual({ percent: "a", endDate: "c", form: "d" });
  });
});

describe("timezone helpers", () => {
  it("handles DST in the shop's timezone", () => {
    expect(zonedDayToUtcIso("2026-07-01", "America/New_York", false)).toBe("2026-07-01T04:00:00.000Z");
    expect(zonedDayToUtcIso("2026-03-08", "America/New_York", true)).toBe("2026-03-09T03:59:59.000Z");
    expect(zonedDayToUtcIso("2026-12-01", "Asia/Tokyo", false)).toBe("2026-11-30T15:00:00.000Z");
    expect(zonedDayToUtcIso("bad", "UTC", false)).toBe("");
  });
  it("converts back to the shop-local calendar day", () => {
    expect(utcIsoToZonedDay("2026-11-30T15:00:00.000Z", "Asia/Tokyo")).toBe("2026-12-01");
    expect(utcIsoToZonedDay("2026-12-01T03:00:00.000Z", "America/New_York")).toBe("2026-11-30");
    expect(utcIsoToZonedDay("nope", "UTC")).toBe("");
  });
});

describe("tiered spend form", () => {
  const tieredEntries = (kind: string, rows: Array<[string, string]>): Array<[string, string]> => [
    ["ruleType", "TIERED_SPEND"],
    ["title", "Spend more"],
    ["priority", "2"],
    ["tierKind", kind],
    ...rows.flatMap(([t, v]): Array<[string, string]> => [["tierThreshold", t], ["tierValue", v]]),
    ["startDate", "2026-12-01"],
    ["combinesProduct", "on"],
    // collection fields from the other type are ignored
    ["collectionIds", "gid://shopify/Collection/1"],
  ];

  it("parses percentage tiers in shop-currency minor units and validates", () => {
    const { draft, errors } = parseRuleForm(fd(tieredEntries("PERCENTAGE", [["100", "10"], ["200.50", "15"], ["300", "20"]])), ctx);
    expect(errors).toEqual([]);
    expect(draft.config).toEqual({
      type: "TIERED_SPEND",
      currencyCode: "USD",
      tiers: [
        { thresholdMinor: 10000, value: { kind: "PERCENTAGE", percent: 10 } },
        { thresholdMinor: 20050, value: { kind: "PERCENTAGE", percent: 15 } },
        { thresholdMinor: 30000, value: { kind: "PERCENTAGE", percent: 20 } },
      ],
    });
    expect(draft.combinesWith).toEqual({ orderDiscounts: false, productDiscounts: true, shippingDiscounts: false });
    expect(validateRule(draft)).toEqual([]);
  });

  it("parses fixed tiers (JPY shop) and reports bad amounts per tier", () => {
    const { draft } = parseRuleForm(fd(tieredEntries("FIXED_AMOUNT", [["5000", "500"], ["10000", "1500"]])), { shopCurrency: "JPY", timezone: "UTC" });
    expect(draft.config).toMatchObject({ currencyCode: "JPY", tiers: [{ thresholdMinor: 5000, value: { kind: "FIXED_AMOUNT", amountMinor: 500 } }, { thresholdMinor: 10000 }] });
    const bad = parseRuleForm(fd(tieredEntries("FIXED_AMOUNT", [["abc", ""], ["200", "x"]])), ctx);
    expect(bad.errors.map((e) => e.field)).toEqual(["config.tiers.0.threshold", "config.tiers.0.value", "config.tiers.1.value"]);
  });

  it("maps tier errors to per-row form fields", () => {
    const { draft } = parseRuleForm(fd(tieredEntries("PERCENTAGE", [["200", "15"], ["100", "10"]])), ctx);
    const byField = errorsByFormField(validateRule(draft));
    expect(byField["tierThreshold.1"]).toMatch(/more spend/);
    expect(byField["tierValue.1"]).toMatch(/smaller discount/);
    expect(errorsByFormField([{ field: "config.tiers", message: "count" }, { field: "ruleType", message: "fixed" }])).toEqual({ tiers: "count", form: "fixed" });
  });

  it("round-trips through draftToFormValues and describes the tiers", () => {
    const { draft } = parseRuleForm(fd(tieredEntries("PERCENTAGE", [["100", "10"], ["200", "15"]])), ctx);
    const v = draftToFormValues(draft, ctx);
    expect(v).toMatchObject({ ruleType: "TIERED_SPEND", tierKind: "PERCENTAGE", tiers: [{ threshold: "100.00", value: "10" }, { threshold: "200.00", value: "15" }], collectionIds: [] });
    expect(describeTiers(draft.config as never)).toEqual(["Spend $100.00 or more: 10% off", "Spend $200.00 or more: 15% off"]);
    expect(describeValue(draft.config)).toBe("Spend $100.00 or more: 10% off · Spend $200.00 or more: 15% off");
  });

  it("previews incomplete rows without crashing", () => {
    const { draft } = parseRuleForm(fd(tieredEntries("FIXED_AMOUNT", [["", ""], ["200", "20"]])), ctx);
    expect(describeTiers(draft.config as never)).toEqual(["Spend ? or more: ? off", "Spend $200.00 or more: $20.00 off"]);
  });

  it("amount-off defaults in draftToFormValues give two empty tier rows", () => {
    const { draft } = parseRuleForm(fd(base), ctx);
    expect(draftToFormValues(draft, ctx).tiers).toEqual([{ threshold: "", value: "" }, { threshold: "", value: "" }]);
  });
});
