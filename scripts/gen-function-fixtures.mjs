// Writes the Function test fixtures. Small fixtures have hand-checked outputs;
// big ones are for instruction counting (outputs are checked by the parity test).
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { C100, bigCart, fixture, line, linesInput, metafield } from "./lib/fixture-builders.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "extensions", "zj-discount-function", "tests");
const write = (dir, name, data) => {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, name), JSON.stringify(data, null, 2) + "\n");
};
const pct = (percent) => ({ kind: "PERCENTAGE", percent });
const product = (candidates) => ({ operations: [{ productDiscountsAdd: { candidates, selectionStrategy: "ALL" } }] });
const cand = (n, amount, message = "10% off Winter") => ({
  message,
  targets: [{ cartLine: { id: `gid://shopify/CartLine/${n}` } }],
  value: { fixedAmount: { amount } },
});
const none = { operations: [] };

// --- hand-checked fixtures (tests/fixtures) ---
write("fixtures", "lines-percent-collection.json", fixture(
  linesInput({
    metafield: metafield({ value: pct(10) }),
    lines: [
      line(1, { quantity: 2, amount: "20.0" }),
      line(2, { amount: "9.99" }),
      line(3, { quantity: 3, amount: "15.0", inCollection: false }),
    ],
  }),
  // 10% of 20.00 = 2.00; 10% of 9.99 = 0.999 → total 2.999 rounds to 3.00, extra cent to line 2
  product([cand(1, "2.00"), cand(2, "1.00")]),
));

write("fixtures", "lines-percent-odd-cents.json", fixture(
  linesInput({
    metafield: metafield({ value: pct(10) }),
    lines: [line(1, { amount: "3.33" }), line(2, { amount: "3.33" }), line(3, { amount: "3.34" })],
  }),
  product([cand(1, "0.33"), cand(2, "0.33"), cand(3, "0.34")]),
));

write("fixtures", "lines-fixed-each-item-jpy.json", fixture(
  linesInput({
    rate: "150.0",
    metafield: metafield({ title: "$5 off each", value: { kind: "FIXED_AMOUNT", amountMinor: 500, currencyCode: "USD", appliesToEachItem: true } }),
    lines: [
      line(1, { amount: "1999", currencyCode: "JPY" }),
      line(2, { quantity: 2, amount: "3001", currencyCode: "JPY" }),
    ],
  }),
  // $5 × 150 = ¥750 per item
  product([cand(1, "750", "$5 off each"), cand(2, "1500", "$5 off each")]),
));

write("fixtures", "lines-fixed-once-clamped.json", fixture(
  linesInput({
    metafield: metafield({ title: "$50 off", value: { kind: "FIXED_AMOUNT", amountMinor: 5000, currencyCode: "USD", appliesToEachItem: false } }),
    lines: [line(1, { quantity: 2, amount: "20.0" }), line(2, { amount: "9.99" }), line(3, { amount: "100.0", inCollection: false })],
  }),
  product([cand(1, "20.00", "$50 off"), cand(2, "9.99", "$50 off")]),
));

write("fixtures", "lines-custom-product-line-ignored.json", fixture(
  linesInput({
    metafield: metafield({ value: pct(10) }),
    lines: [
      { id: "gid://shopify/CartLine/9", quantity: 1, cost: { subtotalAmount: { amount: "50.0", currencyCode: "USD" } }, merchandise: { __typename: "CustomProduct" } },
      line(1, { amount: "10.0" }),
    ],
  }),
  product([cand(1, "1.00")]),
));

write("fixtures", "lines-no-metafield.json", fixture(linesInput({ lines: [line(1, { amount: "10.0" })] }), none));
write("fixtures", "lines-bad-metafield.json", fixture(
  linesInput({ metafield: { jsonValue: { schemaVersion: 99 } }, lines: [line(1, { amount: "10.0" })] }), none));
write("fixtures", "lines-wrong-discount-class.json", fixture(
  linesInput({ discountClasses: ["ORDER"], metafield: metafield({ value: pct(10) }), lines: [line(1, { amount: "10.0" })] }), none));
write("fixtures", "lines-empty-cart.json", fixture(linesInput({ metafield: metafield({ value: pct(10) }), lines: [] }), none));
write("fixtures", "lines-no-eligible-lines.json", fixture(
  linesInput({ metafield: metafield({ value: pct(10) }), lines: [line(1, { amount: "10.0", inCollection: false })] }), none));

write("fixtures", "delivery-noop.json", {
  payload: {
    export: "cart-delivery-options-discounts-generate-run",
    target: "cart.delivery-options.discounts.generate.run",
    input: { discount: { discountClasses: ["SHIPPING"] } },
    output: none,
  },
});

// --- perf fixtures (tests/perf): input + output placeholder; run via scripts/function-perf.mjs ---
for (const [name, lines, qty] of [["cart-200-lines.json", 200, 1], ["cart-250-lines-qty999.json", 250, 999]]) {
  write("perf", name, fixture(linesInput({ metafield: metafield({ value: pct(15) }), lines: bigCart(lines, qty) }), null));
}
console.log("fixtures written");
