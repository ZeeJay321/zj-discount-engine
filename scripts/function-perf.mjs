// Runs the built Function locally (`shopify app function run`) on perf inputs and
// prints instruction counts against Shopify's limit (11M for <=200 lines, scaled above).
// Usage: node scripts/function-perf.mjs   (build the function first)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { line, linesInput, metafield } from "./lib/fixture-builders.mjs";

const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..", "extensions", "zj-discount-function");
const perfDir = join(fnDir, "tests", "perf");
const tmp = mkdtempSync(join(tmpdir(), "zj-perf-"));
const BASE_LIMIT = 11_000_000;

function run(name, input) {
  const file = join(tmp, `${name}.json`);
  writeFileSync(file, JSON.stringify(input));
  const out = execFileSync(
    "npx",
    ["shopify", "app", "function", "run", "--no-input", "--json", "--path", fnDir,
      "--export", "cart-lines-discounts-generate-run", "--input", file],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  const json = JSON.parse(out.slice(out.indexOf("{")));
  const lines = input.cart.lines.length;
  const limit = lines <= 200 ? BASE_LIMIT : Math.round((BASE_LIMIT * lines) / 200);
  const bytes = Buffer.byteLength(JSON.stringify(input));
  const pct = ((json.instructions / limit) * 100).toFixed(1);
  console.log(
    `${name.padEnd(34)} lines=${String(lines).padStart(3)} input=${String(bytes).padStart(6)}B ` +
      `instructions=${String(json.instructions).padStart(11)} limit=${limit} (${pct}%)`,
  );
  return json;
}

const extra = process.argv.includes("--breakdown");
for (const f of readdirSync(perfDir).filter((n) => n.endsWith(".json")).sort()) {
  const input = JSON.parse(readFileSync(join(perfDir, f), "utf8")).payload.input;
  run(f.replace(/\.json$/, ""), input);
  if (extra) {
    // Same cart, no metafield → returns before any core work: cost of input parsing alone.
    run(f.replace(/\.json$/, "") + " (no rule)", { ...input, discount: { ...input.discount, metafield: null } });
  }
}
if (extra) {
  run("1-line cart", linesInput({ metafield: metafield({ value: { kind: "PERCENTAGE", percent: 15 } }), lines: [line(1, { amount: "10.0" })] }));
}
