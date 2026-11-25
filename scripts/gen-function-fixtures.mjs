// Writes the Function test fixtures (plain JSON, function-runner format).
// - tests/fixtures: small carts with hand-checked outputs, plus cap / cap+1.
// - tests/perf:     big carts for instruction counting (outputs checked by the parity test).
// Run: node scripts/gen-function-fixtures.mjs
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPS, bigCart, bogoMetafield, bundleMetafield, customLine, fixedEach, fixedOnce, fixture, line, linesInput, metafield, metafieldV1,
  orderInput, pct, tieredMetafield, tierFixed, tierPct,
} from "./lib/fixture-builders.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "extensions", "zj-discount-function", "tests");
for (const dir of ["fixtures", "perf"]) {
  rmSync(join(root, dir), { recursive: true, force: true });
  mkdirSync(join(root, dir), { recursive: true });
}
const write = (dir, name, data) => writeFileSync(join(root, dir, name), JSON.stringify(data, null, 2) + "\n");

const product = (candidates) => ({ operations: [{ productDiscountsAdd: { candidates, selectionStrategy: "ALL" } }] });
// Amounts are JSON numbers in major units (the Function emits numbers, not Decimal strings).
const cand = (n, amount) => ({ targets: [{ cartLine: { id: `gid://shopify/CartLine/${n}` } }], value: { fixedAmount: { amount } } });
const none = { operations: [] };

// 10% of 20.00 = 2.00; 10% of 9.99 = 0.999 → total 2.999 rounds to 3.00, the extra cent goes to line 2.
write("fixtures", "lines-percent-collection.json", fixture(
  linesInput({
    metafield: metafield({ value: pct(10) }),
    lines: [line(1, { quantity: 2, amount: "20.0" }), line(2, { amount: "9.99" }), line(3, { quantity: 3, amount: "15.0", inCollection: false })],
  }),
  product([cand(1, 2.0), cand(2, 1.0)]),
));

// 10% of 3.33 + 3.33 + 3.34 = 1.00 exactly; the largest remainder (line 3) takes the rounding cent.
write("fixtures", "lines-percent-odd-cents.json", fixture(
  linesInput({ metafield: metafield({ value: pct(10) }), lines: [line(1, { amount: "3.33" }), line(2, { amount: "3.33" }), line(3, { amount: "3.34" })] }),
  product([cand(1, 0.33), cand(2, 0.33), cand(3, 0.34)]),
));

// $5 (shop currency USD) × rate 150 = ¥750 off each item in a JPY cart.
write("fixtures", "lines-fixed-each-item-jpy.json", fixture(
  linesInput({
    rate: "150.0",
    currencyCode: "JPY",
    metafield: metafield({ title: "$5 off each", value: fixedEach(500) }),
    lines: [line(1, { amount: "1999" }), line(2, { quantity: 2, amount: "3000" })],
  }),
  product([cand(1, 750), cand(2, 1500)]),
));

// $50 once per order, but only $29.99 is eligible → both lines free, nothing beyond.
write("fixtures", "lines-fixed-once-clamped.json", fixture(
  linesInput({
    metafield: metafield({ title: "$50 off", value: fixedOnce(5000) }),
    lines: [line(1, { quantity: 2, amount: "20.0" }), line(2, { amount: "9.99" }), line(3, { amount: "100.0", inCollection: false })],
  }),
  product([cand(1, 20.0), cand(2, 9.99)]),
));

write("fixtures", "lines-custom-product-line-ignored.json", fixture(
  linesInput({ metafield: metafield({ value: pct(10) }), lines: [customLine(9, "50.0"), line(1, { amount: "10.0" })] }),
  product([cand(1, 1.0)]),
));

write("fixtures", "lines-no-metafield.json", fixture(linesInput({ lines: [line(1, { amount: "10.0" })] }), none));
write("fixtures", "lines-bad-metafield.json", fixture(
  linesInput({ metafield: { jsonValue: { schemaVersion: 99 } }, lines: [line(1, { amount: "10.0" })] }), none));
write("fixtures", "lines-wrong-discount-class.json", fixture(
  linesInput({ discountClasses: ["ORDER"], metafield: metafield({ value: pct(10) }), lines: [line(1, { amount: "10.0" })] }), none));
write("fixtures", "lines-empty-cart.json", fixture(linesInput({ metafield: metafield({ value: pct(10) }), lines: [] }), none));
write("fixtures", "lines-no-eligible-lines.json", fixture(
  linesInput({ metafield: metafield({ value: pct(10) }), lines: [line(1, { amount: "10.0", inCollection: false })] }), none));

// Amount-off cap: exactly CAPS.AMOUNT_OFF_PRODUCTS lines of 10.00 at 10% → every line gets exactly 1.00.
const AO_CAP = CAPS.AMOUNT_OFF_PRODUCTS;
const capLines = bigCart(AO_CAP, 1, "10.00");
write("fixtures", "lines-at-cap.json", fixture(
  linesInput({ metafield: metafield({ value: pct(10) }), lines: capLines }),
  product(capLines.map((_, i) => cand(i, 1.0))),
));
// One line more → no discount at all (never partial).
write("fixtures", "lines-cap-plus-one.json", fixture(
  linesInput({ metafield: metafield({ value: pct(10) }), lines: bigCart(AO_CAP + 1, 1, "10.00") }),
  none,
));

// A discount saved before schema v2 must keep working unchanged.
write("fixtures", "lines-schema-v1-metafield.json", fixture(
  linesInput({ metafield: metafieldV1({ value: pct(10) }), lines: [line(1, { quantity: 2, amount: "20.0" }), line(2, { amount: "9.99" })] }),
  product([cand(1, 2.0), cand(2, 1.0)]),
));

// --- Tiered spend: $100 → 10%, $200 → 15%, $300 → 20% (order subtotal; lines are ignored) ---
const order = (value) => ({
  operations: [{ orderDiscountsAdd: { candidates: [{ targets: [{ orderSubtotal: { excludedCartLineIds: [] } }], value }], selectionStrategy: "FIRST" } }],
});
const THREE = tieredMetafield({ tiers: [[10000, tierPct(10)], [20000, tierPct(15)], [30000, tierPct(20)]] });
for (const [name, subtotal, out] of [
  ["below-first", "99.99", none],
  ["at-first", "100.00", order({ percentage: { value: 10 } })],
  ["above-first", "100.01", order({ percentage: { value: 10 } })],
  ["below-second", "199.99", order({ percentage: { value: 10 } })],
  ["at-second", "200.00", order({ percentage: { value: 15 } })],
  ["at-third", "300.00", order({ percentage: { value: 20 } })],
  ["above-third", "5000.00", order({ percentage: { value: 20 } })],
  ["zero", "0.0", none],
]) {
  write("fixtures", `tiered-${name}.json`, fixture(orderInput({ subtotal, metafield: THREE }), out));
}
// Fixed tiers in USD on a JPY cart at 150: $50 → $5 (¥7,500 → ¥750), $100 → $15.
const FIXED = tieredMetafield({ title: "Spend & save", tiers: [[5000, tierFixed(500)], [10000, tierFixed(1500)]] });
write("fixtures", "tiered-fixed-jpy-below.json", fixture(orderInput({ subtotal: "7499", currencyCode: "JPY", rate: "150.0", metafield: FIXED }), none));
write("fixtures", "tiered-fixed-jpy-at.json", fixture(orderInput({ subtotal: "7500", currencyCode: "JPY", rate: "150.0", metafield: FIXED }), order({ fixedAmount: { amount: 750 } })));
write("fixtures", "tiered-fixed-jpy-top.json", fixture(orderInput({ subtotal: "20000", currencyCode: "JPY", rate: "150.0", metafield: FIXED }), order({ fixedAmount: { amount: 2250 } })));
// KWD (3 decimals): $100 at 0.307 = 30.700 KWD exactly at tier 1.
write("fixtures", "tiered-kwd-at-first.json", fixture(orderInput({ subtotal: "30.700", currencyCode: "KWD", rate: "0.307", metafield: THREE }), order({ percentage: { value: 10 } })));
// Wrong class (discount saved as PRODUCT) → nothing.
write("fixtures", "tiered-wrong-class.json", fixture(orderInput({ subtotal: "500.00", discountClasses: ["PRODUCT"], metafield: THREE }), none));
// A 40-line cart (above the amount-off cap): tiered rules are not capped.
write("fixtures", "tiered-40-lines.json", fixture(
  linesInput({ discountClasses: ["ORDER"], metafield: THREE, lines: bigCart(40, 1, "10.00") }), // $400 subtotal
  order({ percentage: { value: 20 } }),
));

// --- Buy X get Y (buy 2 get 1 free, limit 3 per order unless noted) ---
// Discounted units go out as a fixed amount on exactly those units: cartLine { id, quantity }.
const bcand = (n, quantity, amount) => ({ targets: [{ cartLine: { id: `gid://shopify/CartLine/${n}`, quantity } }], value: { fixedAmount: { amount } } });
const B2G1 = bogoMetafield();
for (const [units, out] of [
  [1, none],
  [2, none],
  [3, product([bcand(1, 1, 10.0)])],
  [4, product([bcand(1, 1, 10.0)])],
  [6, product([bcand(1, 2, 20.0)])],
]) {
  write("fixtures", `bogo-${units}-units.json`, fixture(linesInput({ metafield: B2G1, lines: [line(1, { quantity: units, unit: "10.00" })] }), out));
}
// Mixed prices 30, 10, 40, 20 → one set → the 10.00 unit (line 2) is free.
write("fixtures", "bogo-mixed-prices.json", fixture(
  linesInput({ metafield: B2G1, lines: [line(1, { unit: "30.00" }), line(2, { unit: "10.00" }), line(3, { unit: "40.00" }), line(4, { unit: "20.00" })] }),
  product([bcand(2, 1, 10.0)]),
));
// Equal cheapest prices: the earlier line wins.
write("fixtures", "bogo-tie-earlier-line.json", fixture(
  linesInput({ metafield: B2G1, lines: [line(1, { unit: "50.00" }), line(2, { unit: "10.00" }), line(3, { unit: "10.00" })] }),
  product([bcand(2, 1, 10.0)]),
));
// 12 units → 4 sets, but the limit is 3.
write("fixtures", "bogo-limit-reached.json", fixture(linesInput({ metafield: B2G1, lines: [line(1, { quantity: 12, unit: "10.00" })] }), product([bcand(1, 3, 30.0)])));
// Quantity 999 on one line, limit 100: 100 units free, no unit expansion.
write("fixtures", "bogo-qty-999.json", fixture(
  linesInput({ metafield: bogoMetafield({ limitPerOrder: 100 }), lines: [line(1, { quantity: 999, unit: "19.99" })] }),
  product([bcand(1, 100, 1999.0)]),
));
// Units outside the set don't count.
write("fixtures", "bogo-lines-outside-set.json", fixture(
  linesInput({ metafield: B2G1, lines: [line(1, { quantity: 5, unit: "1.00", inCollection: false }), line(2, { quantity: 2, unit: "30.00" }), line(3, { unit: "20.00" })] }),
  product([bcand(3, 1, 20.0)]),
));
// Product-list target (Product/2 only).
write("fixtures", "bogo-product-list.json", fixture(
  linesInput({
    metafield: bogoMetafield({ target: { kind: "PRODUCTS", productIds: ["gid://shopify/Product/2"] } }),
    lines: [line(1, { quantity: 3, unit: "5.00", inCollection: false }), line(2, { quantity: 3, unit: "20.00", inCollection: false })],
  }),
  product([bcand(2, 1, 20.0)]),
));
// Per-unit rounding: buy 1 get 1 at 50%, unit 9.99 → 5.00 off each → 2 units = 10.00.
write("fixtures", "bogo-per-unit-rounding.json", fixture(
  linesInput({ metafield: bogoMetafield({ title: "B1G1 50%", buyQuantity: 1, percent: 50 }), lines: [line(1, { quantity: 4, unit: "9.99" })] }),
  product([bcand(1, 2, 10.0)]),
));
write("fixtures", "bogo-jpy-50.json", fixture(
  linesInput({ currencyCode: "JPY", rate: "150.0", metafield: bogoMetafield({ percent: 50 }), lines: [line(1, { quantity: 3, unit: "1999" })] }),
  product([bcand(1, 1, 1000)]),
));
write("fixtures", "bogo-kwd-10.json", fixture(
  linesInput({ currencyCode: "KWD", rate: "0.307", metafield: bogoMetafield({ percent: 10 }), lines: [line(1, { quantity: 3, unit: "12.345" })] }),
  product([bcand(1, 1, 1.235)]),
));
// BOGO cap: CAPS.BUY_X_GET_Y equal-price lines → floor(N/3) sets (limit 100) → the first lines free; one more line → nothing.
const BOGO_CAP = CAPS.BUY_X_GET_Y;
const bogoCapMf = bogoMetafield({ limitPerOrder: 100 });
write("fixtures", "bogo-at-cap.json", fixture(
  linesInput({ metafield: bogoCapMf, lines: bigCart(BOGO_CAP, 1, "10.00") }),
  product(Array.from({ length: Math.floor(BOGO_CAP / 3) }, (_, i) => bcand(i, 1, 10.0))),
));
write("fixtures", "bogo-cap-plus-one.json", fixture(linesInput({ metafield: bogoCapMf, lines: bigCart(BOGO_CAP + 1, 1, "10.00") }), none));

// --- Bundles: Shirt (Product/1) + Jeans (Product/2), 1 each, 20% off, limit 3 unless noted ---
const SHIRT = "gid://shopify/Product/1";
const BUN = bundleMetafield();
const shirt = (n, o) => line(n, { productId: SHIRT, ...o });
const jeans = (n, o) => line(n, { productId: "gid://shopify/Product/2", ...o });
write("fixtures", "bundle-missing-component.json", fixture(linesInput({ metafield: BUN, lines: [shirt(1, { quantity: 4, unit: "30.00" })] }), none));
write("fixtures", "bundle-one.json", fixture(
  linesInput({ metafield: BUN, lines: [shirt(1, { unit: "30.00" }), jeans(2, { unit: "50.00" })] }),
  product([bcand(1, 1, 6.0), bcand(2, 1, 10.0)]),
));
write("fixtures", "bundle-two.json", fixture(
  linesInput({ metafield: BUN, lines: [shirt(1, { quantity: 2, unit: "30.00" }), jeans(2, { quantity: 2, unit: "50.00" })] }),
  product([bcand(1, 2, 12.0), bcand(2, 2, 20.0)]),
));
write("fixtures", "bundle-extras.json", fixture(
  linesInput({ metafield: BUN, lines: [shirt(1, { quantity: 3, unit: "30.00" }), jeans(2, { unit: "50.00" })] }),
  product([bcand(1, 1, 6.0), bcand(2, 1, 10.0)]),
));
write("fixtures", "bundle-limit.json", fixture(
  linesInput({ metafield: bundleMetafield({ limitPerOrder: 2 }), lines: [shirt(1, { quantity: 9, unit: "30.00" }), jeans(2, { quantity: 9, unit: "50.00" })] }),
  product([bcand(1, 2, 12.0), bcand(2, 2, 20.0)]),
));
// Two shirt lines (different variants) at different prices: the cheaper one is used.
write("fixtures", "bundle-component-two-prices.json", fixture(
  linesInput({ metafield: BUN, lines: [shirt(1, { unit: "40.00" }), jeans(2, { unit: "50.00" }), shirt(3, { unit: "30.00" })] }),
  product([bcand(2, 1, 10.0), bcand(3, 1, 6.0)]),
));
write("fixtures", "bundle-qty-999.json", fixture(
  linesInput({ metafield: bundleMetafield({ limitPerOrder: 100 }), lines: [shirt(1, { quantity: 999, unit: "19.99" }), jeans(2, { quantity: 999, unit: "29.99" })] }),
  product([bcand(1, 100, 400.0), bcand(2, 100, 600.0)]),
));
write("fixtures", "bundle-fixed-amount.json", fixture(
  linesInput({ metafield: bundleMetafield({ value: { kind: "FIXED_AMOUNT", amountMinor: 1001 } }), lines: [shirt(1, { unit: "30.00" }), jeans(2, { unit: "50.00" })] }),
  product([bcand(1, 1, 3.75), bcand(2, 1, 6.26)]),
));
write("fixtures", "bundle-fixed-price.json", fixture(
  linesInput({ metafield: bundleMetafield({ value: { kind: "FIXED_PRICE", priceMinor: 6000 } }), lines: [shirt(1, { unit: "30.00" }), jeans(2, { unit: "50.00" })] }),
  product([bcand(1, 1, 7.5), bcand(2, 1, 12.5)]),
));
write("fixtures", "bundle-fixed-price-above-total.json", fixture(
  linesInput({ metafield: bundleMetafield({ value: { kind: "FIXED_PRICE", priceMinor: 9000 } }), lines: [shirt(1, { unit: "30.00" }), jeans(2, { unit: "50.00" })] }),
  none,
));
// Variant component: only ProductVariant/31 of Product/3 counts.
write("fixtures", "bundle-variant-component.json", fixture(
  linesInput({
    metafield: bundleMetafield({
      value: { kind: "PERCENTAGE", percent: 50 },
      components: [
        { kind: "PRODUCT", productId: SHIRT, quantity: 1 },
        { kind: "VARIANT", variantId: "gid://shopify/ProductVariant/31", productId: "gid://shopify/Product/3", quantity: 1 },
      ],
    }),
    lines: [shirt(1, { unit: "20.00" }), line(5, { productId: "gid://shopify/Product/3", unit: "10.00" }), line(6, { productId: "gid://shopify/Product/3", variantId: "gid://shopify/ProductVariant/31", unit: "10.00" })],
  }),
  product([bcand(1, 1, 10.0), bcand(6, 1, 5.0)]),
));
write("fixtures", "bundle-jpy-fixed-price.json", fixture(
  linesInput({ currencyCode: "JPY", rate: "150.0", metafield: bundleMetafield({ value: { kind: "FIXED_PRICE", priceMinor: 5000 } }), lines: [shirt(1, { unit: "4500" }), jeans(2, { unit: "4500" })] }),
  product([bcand(1, 1, 750), bcand(2, 1, 750)]),
));
write("fixtures", "bundle-kwd-fixed-amount.json", fixture(
  linesInput({ currencyCode: "KWD", rate: "0.307", metafield: bundleMetafield({ value: { kind: "FIXED_AMOUNT", amountMinor: 1000 } }), lines: [shirt(1, { unit: "10.000" }), jeans(2, { unit: "20.000" })] }),
  product([bcand(1, 1, 1.023), bcand(2, 1, 2.047)]),
));
// Bundle cap: shirt + jeans + filler up to CAPS.BUNDLE lines → applies; one more line → nothing.
const BUNDLE_CAP = CAPS.BUNDLE;
const filler = (from, count) => Array.from({ length: count }, (_, i) => line(100 + from + i, { unit: "1.00", productId: `gid://shopify/Product/${900 + from + i}` }));
write("fixtures", "bundle-at-cap.json", fixture(
  linesInput({ metafield: BUN, lines: [shirt(1, { unit: "30.00" }), jeans(2, { unit: "50.00" }), ...filler(0, BUNDLE_CAP - 2)] }),
  product([bcand(1, 1, 6.0), bcand(2, 1, 10.0)]),
));
write("fixtures", "bundle-cap-plus-one.json", fixture(
  linesInput({ metafield: BUN, lines: [shirt(1, { unit: "30.00" }), jeans(2, { unit: "50.00" }), ...filler(0, BUNDLE_CAP - 1)] }),
  none,
));

write("fixtures", "delivery-noop.json", {
  payload: {
    export: "cart-delivery-options-discounts-generate-run",
    target: "cart.delivery-options.discounts.generate.run",
    input: { discount: { discountClasses: ["SHIPPING"] } },
    output: none,
  },
});

// Perf: worst case (every line eligible) at the cap, for both value kinds; plus the
// original 200-line and 250×999 carts (above the cap they return early).
write("perf", "cap-percent.json", fixture(linesInput({ metafield: metafield({ value: pct(15) }), lines: bigCart(AO_CAP, 1, "99.99", () => true, true) }), null));
write("perf", "cap-fixed-once.json", fixture(linesInput({ metafield: metafield({ value: fixedOnce(123457) }), lines: bigCart(AO_CAP, 1, "99.99", () => true, true) }), null));
write("perf", "cart-200-lines.json", fixture(linesInput({ metafield: metafield({ value: pct(15) }), lines: bigCart(200, 1, "99.99", (i) => i % 2 === 0, true) }), null));
write("perf", "cart-250-lines-qty999.json", fixture(linesInput({ metafield: metafield({ value: pct(15) }), lines: bigCart(250, 999, "99.99", (i) => i % 2 === 0, true) }), null));
// Tiered perf: lines are always in the input, so measure by cart size.
for (const n of [1, 30, 200]) {
  write("perf", `tiered-${n}-lines.json`, fixture(linesInput({ discountClasses: ["ORDER"], metafield: THREE, lines: bigCart(n, 1, "99.99", () => true, true) }), null));
}
// BOGO perf: distinct prices, quantity 1 and 999. At the cap the worst case is used
// (buy 1 get N−1: almost every line discounted); the other sizes use buy 2 get 1.
const priced = (n, qty) => Array.from({ length: n }, (_, i) => line(i, { quantity: qty, unit: (10 + ((i * 37) % 90)).toFixed(2), realistic: true }));
// 1, 15, the cap, and 30/31 (above the cap they return before any work).
for (const n of [...new Set([1, 15, BOGO_CAP, 30, 31])]) {
  for (const qty of [1, 999]) {
    const atCap = n === BOGO_CAP;
    const name = atCap ? `cap-bogo-qty${qty}.json` : `bogo-${n}-lines-qty${qty}.json`;
    const mf = atCap ? bogoMetafield({ buyQuantity: 1, getQuantity: Math.min(100, n - 1), limitPerOrder: 100 }) : bogoMetafield({ limitPerOrder: 100 });
    write("perf", name, fixture(linesInput({ metafield: mf, lines: priced(n, qty) }), null));
  }
}
// Bundle perf (worst case: fixed bundle price, limit 100, every line in a component,
// distinct prices, real-length ids): even lines → component A, odd lines → component B.
const PA = "gid://shopify/Product/8000000000001";
const PB = "gid://shopify/Product/8000000000002";
const bundlePerfMf = bundleMetafield({
  value: { kind: "FIXED_PRICE", priceMinor: 5000 },
  limitPerOrder: 100,
  components: [{ kind: "PRODUCT", productId: PA, quantity: 1 }, { kind: "PRODUCT", productId: PB, quantity: 1 }],
});
const bundleLines = (n, qty) =>
  Array.from({ length: n }, (_, i) => line(i, { quantity: qty, unit: (20 + ((i * 37) % 90)).toFixed(2), productId: i % 2 === 0 ? PA : PB, realistic: true }));
for (const n of [...new Set([1, 15, BUNDLE_CAP, 30, 31])]) {
  for (const qty of [1, 999]) {
    const name = n === BUNDLE_CAP ? `cap-bundle-qty${qty}.json` : `bundle-${n}-lines-qty${qty}.json`;
    write("perf", name, fixture(linesInput({ metafield: bundlePerfMf, lines: bundleLines(n, qty) }), null));
  }
}
console.log(`fixtures written (caps: ${JSON.stringify(CAPS)})`);
