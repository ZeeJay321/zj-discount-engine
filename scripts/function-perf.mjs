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
import { bigCart, fixedOnce, line, linesInput, metafield, pct } from "./lib/fixture-builders.mjs";

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
  const lines = input.cart.lines.length;
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
  // Worst case: every line eligible. Both value kinds; the cap is the smaller N.
  const variants = { percent: pct(15), "fixed once": fixedOnce(123457) };
  const target = BASE_LIMIT * 0.5;
  let cap = Infinity;
  for (const [label, value] of Object.entries(variants)) {
    const at = (n) => instructions(linesInput({ metafield: metafield({ value }), lines: bigCart(n) }));
    let lo = 1;
    let hi = 200;
    if (at(hi) <= target) lo = hi;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (at(mid) <= target) lo = mid;
      else hi = mid - 1;
    }
    console.log(`${label.padEnd(10)} largest N at <= 50%: ${lo} lines (${at(lo)} instructions; N+1 = ${at(lo + 1)})`);
    cap = Math.min(cap, lo);
  }
  console.log(`=> measured cap: ${cap} lines`);
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
