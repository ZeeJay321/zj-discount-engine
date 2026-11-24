// Parity: every fixture input (small, cap, cap+1 and perf carts) must produce exactly
// the same output from the compiled Wasm Function as from the same TypeScript source
// (adapter + @zj/discount-core) running in Node. The simulator uses that same core,
// so this is what guarantees "Function and simulator give identical results".
// Fixtures are plain JSON, so a future Rust port of the Function can be held to the
// same expectations by pointing this test at the Rust build.
import path from "path";
import fs from "fs";
import { describe, beforeAll, test, expect } from "vitest";
import { buildFunction, getFunctionInfo, loadFixture, runFunction } from "@shopify/shopify-function-test-helpers";
import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";
import { cartDeliveryOptionsDiscountsGenerateRun } from "../src/cart_delivery_options_discounts_generate_run";

const node = {
  "cart-lines-discounts-generate-run": cartLinesDiscountsGenerateRun,
  "cart-delivery-options-discounts-generate-run": cartDeliveryOptionsDiscountsGenerateRun,
};

describe("Wasm ⇄ TypeScript parity", () => {
  let info;
  beforeAll(async () => {
    const functionDir = path.dirname(__dirname);
    await buildFunction(functionDir);
    info = await getFunctionInfo(functionDir);
  }, 60000);

  const files = ["fixtures", "perf"].flatMap((dir) =>
    fs
      .readdirSync(path.join(__dirname, dir))
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(__dirname, dir, f)),
  );

  files.forEach((file) => {
    test(`parity: ${path.relative(__dirname, file)}`, async () => {
      const fixture = await loadFixture(file);
      const { functionRunnerPath, wasmPath, schemaPath, targeting } = info;
      const run = await runFunction(fixture, functionRunnerPath, wasmPath, targeting[fixture.target].inputQueryPath, schemaPath);
      expect(run.error).toBeNull();
      const expected = node[fixture.export](JSON.parse(JSON.stringify(fixture.input)));
      expect(run.result.output).toEqual(JSON.parse(JSON.stringify(expected)));
    }, 20000);
  });
});
