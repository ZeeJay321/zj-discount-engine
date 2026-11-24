import { describe, expect, it } from "vitest";
import { convertMinor, currencyExponent, formatMinor, parseDecimalToMinor, roundHalfUp } from "../src";

describe("currencyExponent", () => {
  it.each([
    ["USD", 2], ["EUR", 2], ["JPY", 0], ["jpy", 0], ["KRW", 0], ["KWD", 3], ["BHD", 3], ["XYZ", 2],
  ])("%s → %i", (code, exp) => expect(currencyExponent(code)).toBe(exp));
});

describe("parseDecimalToMinor", () => {
  it.each([
    ["6.0", 2, 600], ["12.34", 2, 1234], ["12.345", 2, 1235], ["12.344", 2, 1234], ["0.005", 2, 1],
    ["0.004", 2, 0], ["100", 0, 100], ["99.5", 0, 100], ["99.4", 0, 99], ["1.2345", 3, 1235],
    ["-1.50", 2, -150], ["-0.001", 2, 0], ["  7.1 ", 2, 710], ["0", 2, 0],
  ])("%s (exp %i) → %i", (input, exp, minor) => expect(parseDecimalToMinor(input, exp)).toBe(minor));

  it("accepts numbers, including ones JS prints in exponent form", () => {
    expect(parseDecimalToMinor(12.5, 2)).toBe(1250);
    expect(parseDecimalToMinor(1e-7, 2)).toBe(0);
  });

  it.each(["abc", "1e3", "", "1.", ".5", "1,5", "--1"])("rejects %j", (bad) => {
    expect(() => parseDecimalToMinor(bad, 2)).toThrow(/Invalid decimal/);
  });

  it("rejects non-finite numbers and out-of-range values", () => {
    expect(() => parseDecimalToMinor(Number.NaN, 2)).toThrow();
    expect(() => parseDecimalToMinor(Infinity, 2)).toThrow();
    expect(() => parseDecimalToMinor("99999999999999999999", 2)).toThrow(/out of range/);
  });
});

describe("formatMinor", () => {
  it.each([
    [1235, 2, "12.35"], [5, 2, "0.05"], [0, 2, "0.00"], [750, 0, "750"], [1235, 3, "1.235"],
    [-150, 2, "-1.50"], [7, 3, "0.007"],
  ])("%i (exp %i) → %s", (minor, exp, out) => expect(formatMinor(minor, exp)).toBe(out));

  it("round-trips with parseDecimalToMinor", () => {
    for (const exp of [0, 2, 3]) {
      for (const n of [0, 1, 9, 10, 99, 100, 12345, 99899001]) {
        expect(parseDecimalToMinor(formatMinor(n, exp), exp)).toBe(n);
      }
    }
  });

  it("rejects unsafe integers", () => expect(() => formatMinor(1.5, 2)).toThrow());
});

describe("roundHalfUp", () => {
  it.each([[2.5, 3], [2.4, 2], [0.1 + 0.2, 0], [1.005 * 100, 101], [0, 0], [749.9999999, 750]])(
    "%d → %i", (x, n) => expect(roundHalfUp(x)).toBe(n),
  );
});

describe("convertMinor", () => {
  it("is the identity at rate 1 in the same exponent", () => expect(convertMinor(500, "USD", "CAD", 1)).toBe(500));
  it("converts USD → JPY across exponents", () => expect(convertMinor(500, "USD", "JPY", "150.0")).toBe(750));
  it("converts USD → KWD across exponents", () => expect(convertMinor(100, "USD", "KWD", "0.307")).toBe(307));
  it("converts JPY → USD and rounds half up", () => expect(convertMinor(1000, "JPY", "USD", "0.00665")).toBe(665));
  it("handles float-noise rates", () => expect(convertMinor(1000, "USD", "EUR", "1.1")).toBe(1100));
  it.each([0, -1, "abc", Number.NaN])("rejects rate %j", (rate) => {
    expect(() => convertMinor(100, "USD", "EUR", rate as number)).toThrow(/rate/);
  });
});
