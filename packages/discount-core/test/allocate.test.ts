import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocatePercent, allocateProportional } from "../src";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocatePercent", () => {
  it("rounds the total once and gives the extra cent to the largest remainder", () => {
    expect(allocatePercent([333, 333, 334], 1000)).toEqual([33, 33, 34]);
  });
  it("breaks remainder ties by earlier index", () => {
    expect(allocatePercent([333, 333, 334], 5000)).toEqual([167, 166, 167]);
  });
  it("handles 0% and 100%", () => {
    expect(allocatePercent([100, 250], 0)).toEqual([0, 0]);
    expect(allocatePercent([100, 250], 10000)).toEqual([100, 250]);
  });
  it("handles an empty list", () => expect(allocatePercent([], 1500)).toEqual([]));

  it("property: sum equals the half-up rounded total and each share is floor or floor+1", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 900_000_000_000 }), { maxLength: 300 }),
        fc.integer({ min: 0, max: 10000 }),
        (subtotals, bp) => {
          const out = allocatePercent(subtotals, bp);
          const big = subtotals.reduce((a, s) => a + BigInt(s) * BigInt(bp), 0n);
          const expectedTotal = Number((big + 5000n) / 10000n);
          expect(sum(out)).toBe(expectedTotal);
          out.forEach((share, i) => {
            const floor = Math.floor((subtotals[i] * bp) / 10000);
            expect(share === floor || share === floor + 1).toBe(true);
            expect(share).toBeLessThanOrEqual(subtotals[i]);
          });
        },
      ),
    );
  });
});

describe("allocateProportional", () => {
  it("splits proportionally with largest remainder", () => {
    expect(allocateProportional(500, [333, 333, 334])).toEqual([167, 166, 167]);
  });
  it("returns zeros for zero total or zero weights", () => {
    expect(allocateProportional(0, [1, 2])).toEqual([0, 0]);
    expect(allocateProportional(10, [0, 0])).toEqual([0, 0]);
    expect(allocateProportional(10, [])).toEqual([]);
  });
  it("gives everything to the only weighted line", () => expect(allocateProportional(7, [0, 5, 0])).toEqual([0, 7, 0]));

  it("property: sums exactly to total and never exceeds weights when total <= sum", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100_000_000 }), { minLength: 1, maxLength: 300 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (weights, frac) => {
          const sumW = sum(weights);
          const total = Math.floor(sumW * frac);
          const out = allocateProportional(total, weights);
          if (sumW === 0 || total === 0) {
            expect(out.every((x) => x === 0)).toBe(true);
            return;
          }
          expect(sum(out)).toBe(total);
          out.forEach((share, i) => {
            expect(share).toBeGreaterThanOrEqual(0);
            expect(share).toBeLessThanOrEqual(weights[i]);
          });
        },
      ),
    );
  });

  it("still sums to total when total exceeds the weights (uncapped)", () => {
    expect(sum(allocateProportional(1000, [1, 2]))).toBe(1000);
  });
});
