// Instruction counts for the built Function, via `shopify app function run`.
// Shopify's limit: 11M instructions for carts up to 200 lines, scaled linearly above.
//
//   node scripts/function-perf.mjs                 counts for tests/perf/*.json
//   node scripts/function-perf.mjs --breakdown     + same carts with no rule (input parsing only) + 1-line cart
//   node scripts/function-perf.mjs --sweep         largest worst-case cart at <= 50% of the limit
//   node scripts/function-perf.mjs --gate 55       exit 1 if any cap-* fixture exceeds 55% of the limit
//
// Build the function first (npm run build --workspace zj-discount-function).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bigCart, bogoMetafield, bundleMetafield, fixedOnce, line, linesInput, metafield, MIN_CAP, pct } from "./lib/fixture-builders.mjs";

const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..", "extensions", "zj-discount-function");
const perfDir = join(fnDir, "tests", "perf");
const tmp = mkdtempSync(join(tmpdir(), "zj-perf-"));
const BASE_LIMIT = 11_000_000;
const limitFor = (lines) => (lines <= 200 ? BASE_LIMIT : Math.round((BASE_LIMIT * lines) / 200));

function instructions(input) {
  const file = join(tmp, "input.json");
  writeFileSync(file, JSON.stringify(input));
  const out = execFileSync(
    "npx",
    ["shopify", "app", "function", "run", "--no-input", "--json", "--path", fnDir,
      "--export", "cart-lines-discounts-generate-run", "--input", file],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out.slice(out.indexOf("{"))).instructions;
}

function report(name, input) {
  const lines = input.cart.lines?.length ?? 0;
  const n = instructions(input);
  const limit = limitFor(lines);
  const share = (n / limit) * 100;
  const bytes = Buffer.byteLength(JSON.stringify(input));
  console.log(
    `${name.padEnd(36)} lines=${String(lines).padStart(3)} input=${String(bytes).padStart(6)}B ` +
      `instructions=${String(n).padStart(11)} limit=${String(limit).padStart(8)} (${share.toFixed(1)}%)`,
  );
  return share;
}

const args = process.argv.slice(2);
const perfInputs = () =>
  readdirSync(perfDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(perfDir, f), "utf8")).payload.input]);

if (args.includes("--sweep")) {
  // Worst case: every line eligible, real-length ids (parsing cost depends on string
  // length). All product-class rule types; the cap is the smallest N.
  // IMPORTANT: build the Function with every cap in limits.json raised above 200 first,
  // otherwise carts above a current cap return early and the sweep is meaningless.
  if (MIN_CAP <= 200) {
    console.error(`A cap in limits.json is ${MIN_CAP}: raise every cap above 200, rebuild, then sweep.`);
    process.exit(1);
  }
  const priced = (n) => Array.from({ length: n }, (_, i) => line(i, { unit: (10 + ((i * 37) % 90)).toFixed(2), realistic: true }));
  const variants = {
    "amount off %": (n) => linesInput({ metafield: metafield({ value: pct(15) }), lines: bigCart(n, 1, "99.99", () => true, true) }),
    "amount off fixed once": (n) => linesInput({ metafield: metafield({ value: fixedOnce(123457) }), lines: bigCart(n, 1, "99.99", () => true, true) }),
    // Worst case: buy 1 get N−1 on N single-unit lines → N−1 lines discounted.
    "buy 1 get N-1": (n) =>
      linesInput({ metafield: bogoMetafield({ buyQuantity: 1, getQuantity: Math.min(100, Math.max(1, n - 1)), limitPerOrder: 100 }), lines: priced(n) }),
    "bundle fixed price": (n) => {
      const A = "gid://shopify/Product/8000000000001";
      const B = "gid://shopify/Product/8000000000002";
      const mf = bundleMetafield({
        value: { kind: "FIXED_PRICE", priceMinor: 5000 },
        limitPerOrder: 100,
        components: [{ kind: "PRODUCT", productId: A, quantity: 1 }, { kind: "PRODUCT", productId: B, quantity: 1 }],
      });
      const lines = Array.from({ length: n }, (_, i) =>
        line(i, { unit: (20 + ((i * 37) % 90)).toFixed(2), productId: i % 2 === 0 ? A : B, realistic: true }));
      return linesInput({ metafield: mf, lines });
    },
  };
  const target = BASE_LIMIT * 0.5;
  const caps = {};
  for (const [label, build] of Object.entries(variants)) {
    const at = (n) => instructions(build(n));
    let lo = 1;
    let hi = 200;
    if (at(hi) <= target) lo = hi;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (at(mid) <= target) lo = mid;
      else hi = mid - 1;
    }
    console.log(`${label.padEnd(22)} largest N at <= 50%: ${lo} lines (${at(lo)} instructions; N+1 = ${at(lo + 1)})`);
    caps[label] = lo;
  }
  console.log("=> measured caps (set the smallest per rule type in limits.json):", JSON.stringify(caps));
} else if (args.includes("--gate")) {
  const max = Number(args[args.indexOf("--gate") + 1] ?? 55);
  let failed = false;
  for (const [name, input] of perfInputs().filter(([n]) => n.startsWith("cap-"))) {
    if (report(name, input) > max) failed = true;
  }
  if (failed) {
    console.error(`FAIL: a cap fixture is above ${max}% of the instruction limit`);
    process.exit(1);
  }
} else {
  for (const [name, input] of perfInputs()) {
    report(name, input);
    if (args.includes("--breakdown")) {
      report(`${name} (no rule)`, { ...input, discount: { ...input.discount, metafield: null } });
    }
  }
  if (args.includes("--breakdown")) {
    report("1-line cart", linesInput({ metafield: metafield({ value: pct(15) }), lines: [line(1, { amount: "10.0" })] }));
  }
}
