import { describe, expect, it } from "vitest";
import { RULE_CONFIG_SCHEMA_VERSION, type RuleDraft } from "@zj/discount-core";
import {
  deleteRule,
  reconcile,
  retrySync,
  revertToSynced,
  saveRule,
  setEnabled,
  shopifyWindow,
  STALE_AFTER_MS,
  toDiscountInput,
  type SyncDeps,
} from "../discount-sync.server";
import { appDiscounts, C1, count, created, fakeGql, memoryRepo, pct10, SHOP, updated, userError } from "./fakes";

const NOW = new Date("2026-12-01T12:00:00.000Z");

function draft(o: Partial<RuleDraft> = {}): RuleDraft {
  return {
    title: "10% off Winter",
    enabled: true,
    priority: 1,
    startsAt: "2026-11-30T00:00:00.000Z",
    endsAt: null,
    combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
    config: pct10,
    ...o,
  };
}

function setup(handlers: Parameters<typeof fakeGql>[0], clock = () => NOW) {
  const mem = memoryRepo(clock);
  const fake = fakeGql({ ZjActiveAutomaticDiscounts: count(3), ...handlers });
  const deps: SyncDeps = { repo: mem.repo, gql: fake.gql, shop: SHOP, now: clock };
  return { ...mem, ...fake, deps };
}

describe("toDiscountInput", () => {
  it("sends discount fields and the rule-config metafield in ONE input", () => {
    const input = toDiscountInput("rule_1", { ...draft() }, NOW);
    expect(input).toMatchObject({
      title: "10% off Winter",
      functionHandle: "zj-discount-function",
      discountClasses: ["PRODUCT"],
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
      startsAt: "2026-11-30T00:00:00.000Z",
      endsAt: null,
    });
    expect(input.metafields).toHaveLength(1);
    const mf = input.metafields[0];
    expect(mf).toMatchObject({ namespace: "$app", key: "rule-config", type: "json" });
    expect(JSON.parse(mf.value)).toEqual({
      schemaVersion: RULE_CONFIG_SCHEMA_VERSION,
      ruleId: "rule_1",
      title: "10% off Winter",
      collectionIds: [C1],
      config: pct10,
    });
  });
});

describe("shopifyWindow", () => {
  it("enabled: the rule's real dates", () => {
    expect(shopifyWindow({ ...draft(), endsAt: "2027-01-01T00:00:00.000Z" }, NOW)).toEqual({
      startsAt: "2026-11-30T00:00:00.000Z",
      endsAt: "2027-01-01T00:00:00.000Z",
    });
  });
  it("disabled: already ended now, start kept before the end", () => {
    expect(shopifyWindow({ ...draft(), enabled: false }, NOW)).toEqual({
      startsAt: "2026-11-30T00:00:00.000Z",
      endsAt: NOW.toISOString(),
    });
  });
  it("disabled with a future start: start moved just before now so end > start", () => {
    const w = shopifyWindow({ ...draft(), enabled: false, startsAt: "2027-02-01T00:00:00.000Z" }, NOW);
    expect(w.endsAt).toBe(NOW.toISOString());
    expect(Date.parse(w.startsAt)).toBe(NOW.getTime() - 60_000);
  });
});

describe("saveRule", () => {
  it("creates: row PENDING → one create mutation → SYNCED with syncedConfig", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    const res = await saveRule(t.deps, draft());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(t.ops()).toEqual(["ZjActiveAutomaticDiscounts", "ZjCreateRuleDiscount"]);
    expect(res.rule).toMatchObject({
      syncStatus: "SYNCED",
      shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/1",
      syncedVersion: 1,
      syncError: null,
    });
    expect(res.rule.syncedConfig).toMatchObject({ title: "10% off Winter", config: pct10 });
    expect(t.events).toEqual([{ ruleId: res.rule.id, shop: SHOP, action: "create", ok: true }]);
  });

  it("rejects invalid drafts before touching the DB or Shopify", async () => {
    const t = setup({});
    const res = await saveRule(t.deps, draft({ config: { ...pct10, value: { kind: "PERCENTAGE", percent: 150 } } }));
    expect(res.ok).toBe(false);
    expect(t.calls).toHaveLength(0);
    expect(t.rows.size).toBe(0);
  });

  it("rejects an overlapping rule with the same priority (server-side check)", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    await saveRule(t.deps, draft({ title: "First" }));
    const res = await saveRule(t.deps, draft({ title: "Second" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0].message).toContain("First");
  });

  it("blocks a new enabled rule when the store has 25 automatic discounts", async () => {
    const t = setup({ ZjActiveAutomaticDiscounts: count(25) });
    const res = await saveRule(t.deps, draft());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatchObject({ field: "enabled" });
    expect(res.errors[0].message).toContain("25 of 25");
    expect(t.rows.size).toBe(0);
  });

  it("blocks when the quota can't be checked (fails closed)", async () => {
    const t = setup({ ZjActiveAutomaticDiscounts: () => { throw new Error("timeout"); } });
    const res = await saveRule(t.deps, draft());
    expect(res.ok).toBe(false);
  });

  it("Shopify userErrors: rule kept as FAILED with the message; nothing marked synced", async () => {
    const t = setup({ ZjCreateRuleDiscount: userError("discountAutomaticAppCreate", "Title is too long") });
    const res = await saveRule(t.deps, draft());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rule).toMatchObject({
      syncStatus: "FAILED",
      syncError: "automaticAppDiscount.title: Title is too long",
      shopifyDiscountId: null,
      syncedVersion: null,
      syncedConfig: null,
    });
    expect(t.events[0]).toMatchObject({ action: "create", ok: false });
  });

  it("network failure: FAILED with the error", async () => {
    const t = setup({ ZjCreateRuleDiscount: () => { throw new Error("socket hang up"); } });
    const res = await saveRule(t.deps, draft());
    expect(res.ok && res.rule.syncStatus).toBe("FAILED");
    expect(res.ok && res.rule.syncError).toBe("socket hang up");
  });

  it("edit: bumps configVersion and updates (no quota check for an already enabled rule)", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjUpdateRuleDiscount: updated() });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    const res = await saveRule(t.deps, draft({ id: first.rule.id, title: "12% off Winter", config: { ...pct10, value: { kind: "PERCENTAGE", percent: 12 } } }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(t.ops()).toEqual(["ZjActiveAutomaticDiscounts", "ZjCreateRuleDiscount", "ZjUpdateRuleDiscount"]);
    expect(res.rule).toMatchObject({ configVersion: 2, syncedVersion: 2, syncStatus: "SYNCED", title: "12% off Winter" });
    const sent = t.calls[2].variables as { id: string; automaticAppDiscount: { metafields: Array<{ value: string }> } };
    expect(sent.id).toBe("gid://shopify/DiscountAutomaticNode/1");
    expect(JSON.parse(sent.automaticAppDiscount.metafields[0].value).config.value.percent).toBe(12);
  });

  it("failed edit keeps the previous synced state, so the UI can revert", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjUpdateRuleDiscount: userError("discountAutomaticAppUpdate", "nope") });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    const res = await saveRule(t.deps, draft({ id: first.rule.id, title: "Changed" }));
    if (!res.ok) throw new Error("expected saved locally");
    expect(res.rule).toMatchObject({ syncStatus: "FAILED", title: "Changed", configVersion: 2, syncedVersion: 1 });
    expect(res.rule.syncedConfig?.title).toBe("10% off Winter");
    expect(res.rule.shopifyDiscountId).toBe("gid://shopify/DiscountAutomaticNode/1");
  });

  it("rejects editing an unknown rule", async () => {
    const t = setup({});
    expect((await saveRule(t.deps, draft({ id: "nope" }))).ok).toBe(false);
  });
});

describe("retry and revert", () => {
  it("retry after a failed edit re-sends the desired state", async () => {
    let fail = true;
    const t = setup({
      ZjCreateRuleDiscount: created(),
      ZjUpdateRuleDiscount: () => (fail ? userError("discountAutomaticAppUpdate", "busy")() : updated()()),
    });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    await saveRule(t.deps, draft({ id: first.rule.id, title: "Changed" }));
    fail = false;
    const r = await retrySync(t.deps, first.rule.id);
    expect(r).toMatchObject({ syncStatus: "SYNCED", syncedVersion: 2, title: "Changed" });
    expect(r?.syncedConfig?.title).toBe("Changed");
  });

  it("retry of a failed create first looks for an orphaned discount (no duplicate create)", async () => {
    let createFails = true;
    const t = setup({
      ZjCreateRuleDiscount: () => (createFails ? (() => { throw new Error("timeout after Shopify created it"); })() : created()()),
      ZjAppDiscounts: appDiscounts([{ id: "gid://shopify/DiscountAutomaticNode/77", ruleId: "rule_1" }]),
      ZjUpdateRuleDiscount: updated("gid://shopify/DiscountAutomaticNode/77"),
    });
    const res = await saveRule(t.deps, draft());
    if (!res.ok) throw new Error("setup");
    expect(res.rule.syncStatus).toBe("FAILED");
    createFails = false;
    const r = await retrySync(t.deps, res.rule.id);
    expect(t.ops().slice(-2)).toEqual(["ZjAppDiscounts", "ZjUpdateRuleDiscount"]);
    expect(t.ops().filter((o) => o === "ZjCreateRuleDiscount")).toHaveLength(1);
    expect(r).toMatchObject({ syncStatus: "SYNCED", shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/77" });
    expect(t.events.at(-1)).toMatchObject({ action: "relink", ok: true });
  });

  it("revert puts the row back to the last synced state", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjUpdateRuleDiscount: userError("discountAutomaticAppUpdate", "nope") });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    await saveRule(t.deps, draft({ id: first.rule.id, title: "Changed" }));
    const res = await revertToSynced(t.deps, first.rule.id);
    expect(res.ok && res.rule).toMatchObject({ title: "10% off Winter", syncStatus: "SYNCED", configVersion: 1, syncError: null });
  });

  it("revert is refused for a rule that was never synced", async () => {
    const t = setup({ ZjCreateRuleDiscount: userError("discountAutomaticAppCreate", "x") });
    const res = await saveRule(t.deps, draft());
    if (!res.ok) throw new Error("setup");
    expect((await revertToSynced(t.deps, res.rule.id)).ok).toBe(false);
    expect((await revertToSynced(t.deps, "missing")).ok).toBe(false);
  });

  it("recreates the discount if it was deleted in Shopify admin", async () => {
    let createN = 0;
    const t = setup({
      ZjCreateRuleDiscount: () => created(`gid://shopify/DiscountAutomaticNode/${++createN}`)(),
      ZjUpdateRuleDiscount: () => ({
        discountAutomaticAppUpdate: { automaticAppDiscount: null, userErrors: [{ field: ["id"], message: "Discount does not exist", code: null }] },
      }),
    });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    const res = await saveRule(t.deps, draft({ id: first.rule.id, title: "Changed" }));
    expect(t.ops().slice(-2)).toEqual(["ZjUpdateRuleDiscount", "ZjCreateRuleDiscount"]);
    expect(res.ok && res.rule).toMatchObject({ syncStatus: "SYNCED", shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/2" });
    expect(t.events.at(-1)).toMatchObject({ action: "create", ok: true });
  });

  it("retry of an unknown rule returns null", async () => {
    expect(await retrySync(setup({}).deps, "missing")).toBeNull();
  });
});

describe("enable / disable", () => {
  it("disable sends the rule as ended now through the same update mutation", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjUpdateRuleDiscount: updated() });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    const res = await setEnabled(t.deps, first.rule.id, false);
    expect(res.ok && res.rule).toMatchObject({ enabled: false, syncStatus: "SYNCED", configVersion: 2 });
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: { endsAt: string } };
    expect(sent.automaticAppDiscount.endsAt).toBe(NOW.toISOString());
  });

  it("enable checks the quota and sends the real dates again", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjUpdateRuleDiscount: updated() });
    const first = await saveRule(t.deps, draft({ endsAt: "2027-01-01T00:00:00.000Z" }));
    if (!first.ok) throw new Error("setup");
    await setEnabled(t.deps, first.rule.id, false);
    const res = await setEnabled(t.deps, first.rule.id, true);
    expect(res.ok && res.rule.enabled).toBe(true);
    expect(t.ops().filter((o) => o === "ZjActiveAutomaticDiscounts")).toHaveLength(2);
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: { endsAt: string } };
    expect(sent.automaticAppDiscount.endsAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("enable is blocked at 25 automatic discounts", async () => {
    let n = 3;
    const t = setup({ ZjActiveAutomaticDiscounts: () => count(n)(), ZjCreateRuleDiscount: created(), ZjUpdateRuleDiscount: updated() });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    await setEnabled(t.deps, first.rule.id, false);
    n = 25;
    const res = await setEnabled(t.deps, first.rule.id, true);
    expect(res.ok).toBe(false);
    expect((await t.repo.get(SHOP, first.rule.id))?.enabled).toBe(false);
  });

  it("enable re-checks same-priority overlap", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjUpdateRuleDiscount: updated() });
    const a = await saveRule(t.deps, draft({ title: "A" }));
    if (!a.ok) throw new Error("setup");
    await setEnabled(t.deps, a.rule.id, false);
    await saveRule(t.deps, draft({ title: "B" }));
    const res = await setEnabled(t.deps, a.rule.id, true);
    expect(res.ok).toBe(false);
  });

  it("no-op when already in the requested state; error for unknown rule", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    const before = t.calls.length;
    expect((await setEnabled(t.deps, first.rule.id, true)).ok).toBe(true);
    expect(t.calls.length).toBe(before);
    expect((await setEnabled(t.deps, "missing", true)).ok).toBe(false);
  });
});

describe("delete", () => {
  const del = (errs: Array<{ message: string; code?: string }> = []) => () => ({
    discountAutomaticDelete: { deletedAutomaticDiscountId: errs.length ? null : "x", userErrors: errs },
  });

  it("deletes the Shopify discount, then the row", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjDeleteRuleDiscount: del() });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    expect(await deleteRule(t.deps, first.rule.id)).toEqual({ ok: true });
    expect(t.rows.size).toBe(0);
    expect(t.calls.at(-1)!.variables).toEqual({ id: "gid://shopify/DiscountAutomaticNode/1" });
  });

  it("a discount that's already gone counts as deleted", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjDeleteRuleDiscount: del([{ message: "Discount does not exist" }]) });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    expect((await deleteRule(t.deps, first.rule.id)).ok).toBe(true);
    expect(t.rows.size).toBe(0);
  });

  it("keeps the row as DELETING with the error when Shopify refuses", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjDeleteRuleDiscount: del([{ message: "Internal error" }]) });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    const res = await deleteRule(t.deps, first.rule.id);
    expect(res.ok).toBe(false);
    expect(await t.repo.get(SHOP, first.rule.id)).toMatchObject({ syncStatus: "DELETING", syncError: "Internal error" });
  });

  it("keeps the row on a network error", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjDeleteRuleDiscount: () => { throw new Error("offline"); } });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    expect((await deleteRule(t.deps, first.rule.id)).ok).toBe(false);
    expect(t.rows.size).toBe(1);
  });

  it("deleting a never-synced rule also removes an orphaned discount found by ruleId", async () => {
    const t = setup({
      ZjCreateRuleDiscount: userError("discountAutomaticAppCreate", "x"),
      ZjAppDiscounts: appDiscounts([{ id: "gid://shopify/DiscountAutomaticNode/9", ruleId: "rule_1" }]),
      ZjDeleteRuleDiscount: del(),
    });
    const res = await saveRule(t.deps, draft());
    if (!res.ok) throw new Error("setup");
    expect((await deleteRule(t.deps, res.rule.id)).ok).toBe(true);
    expect(t.calls.at(-1)!.variables).toEqual({ id: "gid://shopify/DiscountAutomaticNode/9" });
  });

  it("deleting an unknown rule is a no-op", async () => {
    expect(await deleteRule(setup({}).deps, "missing")).toEqual({ ok: true });
  });
});

describe("reconcile", () => {
  it("retries PENDING rows older than the stale window, relinking an orphan", async () => {
    let now = NOW;
    const clock = () => now;
    const t = setup(
      {
        ZjAppDiscounts: appDiscounts([{ id: "gid://shopify/DiscountAutomaticNode/5", ruleId: "rule_1" }]),
        ZjUpdateRuleDiscount: updated("gid://shopify/DiscountAutomaticNode/5"),
      },
      clock,
    );
    // Simulate a crash after the row was written PENDING but before Shopify's answer was stored.
    await t.repo.create(SHOP, { ...draft() });
    expect(await reconcile(t.deps)).toBe(0); // not stale yet
    now = new Date(NOW.getTime() + STALE_AFTER_MS + 1000);
    expect(await reconcile(t.deps)).toBe(1);
    expect(await t.repo.get(SHOP, "rule_1")).toMatchObject({
      syncStatus: "SYNCED",
      shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/5",
    });
  });

  it("finishes stale deletes", async () => {
    let now = NOW;
    const t = setup(
      {
        ZjCreateRuleDiscount: created(),
        ZjDeleteRuleDiscount: () => ({ discountAutomaticDelete: { deletedAutomaticDiscountId: "x", userErrors: [] } }),
      },
      () => now,
    );
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    await t.repo.update(SHOP, first.rule.id, { syncStatus: "DELETING" });
    now = new Date(NOW.getTime() + STALE_AFTER_MS + 1000);
    expect(await reconcile(t.deps)).toBe(1);
    expect(t.rows.size).toBe(0);
  });

  it("handles at most maxRules per call", async () => {
    let now = NOW;
    const t = setup({ ZjAppDiscounts: appDiscounts([]), ZjCreateRuleDiscount: created() }, () => now);
    for (let i = 0; i < 3; i++) await t.repo.create(SHOP, { ...draft(), priority: i });
    now = new Date(NOW.getTime() + STALE_AFTER_MS + 1000);
    expect(await reconcile(t.deps, 2)).toBe(2);
  });
});

describe("tiered spend rules", () => {
  const tiers: RuleDraft["config"] = {
    type: "TIERED_SPEND",
    currencyCode: "USD",
    tiers: [
      { thresholdMinor: 10000, value: { kind: "PERCENTAGE", percent: 10 } },
      { thresholdMinor: 20000, value: { kind: "PERCENTAGE", percent: 15 } },
      { thresholdMinor: 30000, value: { kind: "PERCENTAGE", percent: 20 } },
    ],
  };

  it("are created with discountClasses ORDER and no collections", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    const res = await saveRule(t.deps, draft({ title: "Spend more", config: tiers }));
    expect(res.ok && res.rule.syncStatus).toBe("SYNCED");
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(sent.automaticAppDiscount.discountClasses).toEqual(["ORDER"]);
    const payload = JSON.parse(sent.automaticAppDiscount.metafields[0].value);
    expect(payload).toMatchObject({ schemaVersion: RULE_CONFIG_SCHEMA_VERSION, collectionIds: [], config: tiers });
  });

  it.each([
    [{ orderDiscounts: true, productDiscounts: true, shippingDiscounts: false }],
    [{ orderDiscounts: false, productDiscounts: true, shippingDiscounts: true }],
    [{ orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }],
  ])("send combinesWith exactly as chosen: %j", async (combinesWith) => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    await saveRule(t.deps, draft({ config: tiers, combinesWith }));
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(sent.automaticAppDiscount.combinesWith).toEqual(combinesWith);
  });

  it("can coexist with an amount-off rule at a different priority, each with its own class", async () => {
    let n = 0;
    const t = setup({ ZjCreateRuleDiscount: () => created(`gid://shopify/DiscountAutomaticNode/${++n}`)() });
    await saveRule(t.deps, draft({ priority: 1, combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: false } }));
    await saveRule(t.deps, draft({ priority: 2, config: tiers, combinesWith: { orderDiscounts: false, productDiscounts: true, shippingDiscounts: false } }));
    const classes = t.calls.filter((c) => c.op === "ZjCreateRuleDiscount").map((c) => (c.variables as { automaticAppDiscount: { discountClasses: string[] } }).automaticAppDiscount.discountClasses);
    expect(classes).toEqual([["PRODUCT"], ["ORDER"]]);
  });

  it("rejects changing a rule's type after creation (server side)", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjUpdateRuleDiscount: updated() });
    const first = await saveRule(t.deps, draft());
    if (!first.ok) throw new Error("setup");
    const before = t.calls.length;
    const res = await saveRule(t.deps, draft({ id: first.rule.id, config: tiers }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatchObject({ field: "ruleType" });
    expect(t.calls.length).toBe(before);
    expect((await t.repo.get(SHOP, first.rule.id))?.config.type).toBe("AMOUNT_OFF_PRODUCTS");
  });

  it("editing a tiered rule keeps ORDER and updates the tiers", async () => {
    const t = setup({ ZjCreateRuleDiscount: created(), ZjUpdateRuleDiscount: updated() });
    const first = await saveRule(t.deps, draft({ config: tiers }));
    if (!first.ok) throw new Error("setup");
    const changed = { ...tiers, tiers: tiers.tiers.slice(0, 2) } as RuleDraft["config"];
    const res = await saveRule(t.deps, draft({ id: first.rule.id, config: changed }));
    expect(res.ok && res.rule.syncStatus).toBe("SYNCED");
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(sent.automaticAppDiscount.discountClasses).toEqual(["ORDER"]);
    expect(JSON.parse(sent.automaticAppDiscount.metafields[0].value).config.tiers).toHaveLength(2);
  });
});

describe("buy X get Y rules", () => {
  const bogo: RuleDraft["config"] = {
    type: "BUY_X_GET_Y",
    target: { kind: "PRODUCTS", productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"] },
    buyQuantity: 2,
    getQuantity: 1,
    percent: 100,
    limitPerOrder: 3,
  };

  it("are created as PRODUCT discounts with the current metafield version (product list, no collection variable)", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    const res = await saveRule(t.deps, draft({ title: "Buy 2 get 1 free", config: bogo }));
    expect(res.ok && res.rule.syncStatus).toBe("SYNCED");
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(sent.automaticAppDiscount.discountClasses).toEqual(["PRODUCT"]);
    expect(JSON.parse(sent.automaticAppDiscount.metafields[0].value)).toEqual({
      schemaVersion: RULE_CONFIG_SCHEMA_VERSION,
      ruleId: res.ok ? res.rule.id : "",
      title: "Buy 2 get 1 free",
      collectionIds: [],
      config: bogo,
    });
  });

  it("collection-targeted BOGO fills the collection input variable", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    await saveRule(t.deps, draft({ config: { ...bogo, target: { kind: "COLLECTIONS", collectionIds: [C1] } } as RuleDraft["config"] }));
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(JSON.parse(sent.automaticAppDiscount.metafields[0].value).collectionIds).toEqual([C1]);
  });

  it.each([
    [{ orderDiscounts: true, productDiscounts: false, shippingDiscounts: true }],
    [{ orderDiscounts: false, productDiscounts: true, shippingDiscounts: false }],
  ])("send combinesWith exactly as chosen: %j", async (combinesWith) => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    await saveRule(t.deps, draft({ config: bogo, combinesWith }));
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(sent.automaticAppDiscount.combinesWith).toEqual(combinesWith);
  });

  it("type is fixed: BOGO → amount off is rejected, and amount off → BOGO too", async () => {
    let n = 0;
    const t = setup({ ZjCreateRuleDiscount: () => created(`gid://shopify/DiscountAutomaticNode/${++n}`)() });
    const a = await saveRule(t.deps, draft({ priority: 1, config: bogo }));
    const b = await saveRule(t.deps, draft({ priority: 2 }));
    if (!a.ok || !b.ok) throw new Error("setup");
    expect((await saveRule(t.deps, draft({ id: a.rule.id, priority: 1 }))).ok).toBe(false);
    expect((await saveRule(t.deps, draft({ id: b.rule.id, priority: 2, config: bogo }))).ok).toBe(false);
  });

  it("invalid BOGO values are rejected before any Shopify call", async () => {
    const t = setup({});
    const res = await saveRule(t.deps, draft({ config: { ...bogo, getQuantity: 0, limitPerOrder: 101 } as RuleDraft["config"] }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.map((e) => e.field).sort()).toEqual(["config.getQuantity", "config.limitPerOrder"]);
    expect(t.calls).toHaveLength(0);
  });
});

describe("bundle rules", () => {
  const bundle: RuleDraft["config"] = {
    type: "BUNDLE",
    currencyCode: "USD",
    components: [
      { kind: "PRODUCT", productId: "gid://shopify/Product/1", quantity: 1 },
      { kind: "VARIANT", variantId: "gid://shopify/ProductVariant/22", productId: "gid://shopify/Product/2", quantity: 1 },
    ],
    value: { kind: "PERCENTAGE", percent: 20 },
    limitPerOrder: 3,
  };

  it("are created as PRODUCT discounts with a v4 metafield", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    const res = await saveRule(t.deps, draft({ title: "Shirt + Jeans", config: bundle }));
    expect(res.ok && res.rule.syncStatus).toBe("SYNCED");
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(sent.automaticAppDiscount.discountClasses).toEqual(["PRODUCT"]);
    expect(JSON.parse(sent.automaticAppDiscount.metafields[0].value)).toMatchObject({ schemaVersion: 5, collectionIds: [], config: bundle });
  });

  it.each([
    [{ orderDiscounts: true, productDiscounts: false, shippingDiscounts: true }],
    [{ orderDiscounts: false, productDiscounts: true, shippingDiscounts: false }],
  ])("send combinesWith exactly as chosen: %j", async (combinesWith) => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    await saveRule(t.deps, draft({ config: bundle, combinesWith }));
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(sent.automaticAppDiscount.combinesWith).toEqual(combinesWith);
  });

  it("type is fixed after creation", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    const a = await saveRule(t.deps, draft({ config: bundle }));
    if (!a.ok) throw new Error("setup");
    const res = await saveRule(t.deps, draft({ id: a.rule.id }));
    expect(res.ok).toBe(false);
  });

  it("invalid bundles are rejected before any Shopify call", async () => {
    const t = setup({});
    const res = await saveRule(t.deps, draft({ config: { ...bundle, components: [bundle.type === "BUNDLE" ? bundle.components[0] : null] } as RuleDraft["config"] }));
    expect(res.ok).toBe(false);
    expect(t.calls).toHaveLength(0);
  });
});

describe("saveRule — free shipping", () => {
  const ship: RuleDraft["config"] = {
    type: "FREE_SHIPPING",
    currencyCode: "USD",
    thresholdMinor: 10000,
    percent: 100,
    maxAmountMinor: null,
    appliesTo: "ALL",
  };
  const shipCombines = { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false };
  const shipDraft = (o: Partial<RuleDraft> = {}) =>
    draft({ title: "Free ship $100", config: ship, combinesWith: shipCombines, ...o });

  it("creates a SHIPPING-class discount with schema v5", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    const res = await saveRule(t.deps, shipDraft());
    expect(res.ok && res.rule.syncStatus).toBe("SYNCED");
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(sent.automaticAppDiscount.discountClasses).toEqual(["SHIPPING"]);
    expect(sent.automaticAppDiscount.combinesWith.shippingDiscounts).toBe(false);
    expect(JSON.parse(sent.automaticAppDiscount.metafields[0].value)).toMatchObject({
      schemaVersion: 5,
      collectionIds: [],
      config: ship,
    });
  });

  it.each([
    [{ orderDiscounts: true, productDiscounts: false, shippingDiscounts: false }],
    [{ orderDiscounts: false, productDiscounts: true, shippingDiscounts: false }],
  ])("send combinesWith for product/order as chosen: %j", async (combinesWith) => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    await saveRule(t.deps, shipDraft({ combinesWith }));
    const sent = t.calls.at(-1)!.variables as { automaticAppDiscount: ReturnType<typeof toDiscountInput> };
    expect(sent.automaticAppDiscount.combinesWith).toEqual(combinesWith);
  });

  it("forces shippingDiscounts false for free shipping (Shopify forbids stacking shipping)", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const input = toDiscountInput("rule_x", {
      title: "Free ship",
      enabled: true,
      priority: 0,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true },
      config: ship,
    }, now);
    expect(input.combinesWith).toEqual({
      orderDiscounts: true,
      productDiscounts: true,
      shippingDiscounts: false,
    });
  });

  it("type is fixed after creation", async () => {
    const t = setup({ ZjCreateRuleDiscount: created() });
    const a = await saveRule(t.deps, shipDraft());
    if (!a.ok) throw new Error("setup");
    const res = await saveRule(t.deps, shipDraft({ id: a.rule.id, config: pct10 }));
    expect(res.ok).toBe(false);
  });
});
