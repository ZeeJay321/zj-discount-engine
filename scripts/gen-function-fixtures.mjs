// Writes the Function test fixtures (plain JSON, function-runner format).
// - tests/fixtures: small carts with hand-checked outputs, plus cap / cap+1.
// - tests/perf:     big carts for instruction counting (outputs checked by the parity test).
// Run: node scripts/gen-function-fixtures.mjs
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_CART_LINES, bigCart, customLine, fixedEach, fixedOnce, fixture, line, linesInput, metafield, pct,
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
    lines: [line(1, { amount: "1999" }), line(2, { quantity: 2, amount: "3001" })],
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

// Cap: exactly MAX_CART_LINES lines of 10.00 at 10% → every line gets exactly 1.00.
const capLines = bigCart(MAX_CART_LINES, 1, "10.00");
write("fixtures", "lines-at-cap.json", fixture(
  linesInput({ metafield: metafield({ value: pct(10) }), lines: capLines }),
  product(capLines.map((_, i) => cand(i, 1.0))),
));
// One line more → no discount at all (never partial).
write("fixtures", "lines-cap-plus-one.json", fixture(
  linesInput({ metafield: metafield({ value: pct(10) }), lines: bigCart(MAX_CART_LINES + 1, 1, "10.00") }),
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
write("perf", "cap-percent.json", fixture(linesInput({ metafield: metafield({ value: pct(15) }), lines: bigCart(MAX_CART_LINES) }), null));
write("perf", "cap-fixed-once.json", fixture(linesInput({ metafield: metafield({ value: fixedOnce(123457) }), lines: bigCart(MAX_CART_LINES) }), null));
write("perf", "cart-200-lines.json", fixture(linesInput({ metafield: metafield({ value: pct(15) }), lines: bigCart(200, 1, "99.99", (i) => i % 2 === 0) }), null));
write("perf", "cart-250-lines-qty999.json", fixture(linesInput({ metafield: metafield({ value: pct(15) }), lines: bigCart(250, 999, "99.99", (i) => i % 2 === 0) }), null));
console.log(`fixtures written (MAX_CART_LINES=${MAX_CART_LINES})`);
