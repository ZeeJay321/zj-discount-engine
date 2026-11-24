/**
 * Money helpers. All amounts are integer minor units; decimals only appear at the
 * edges (parsing Shopify Decimal strings, formatting output Decimals).
 */

// ISO 4217 currencies whose minor unit is not 2 decimals.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyExponent(currencyCode: string): number {
  const code = currencyCode.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/**
 * Parse a decimal string ("12.5", "6.0", "100") to integer minor units, rounding
 * half up on any digits beyond the currency's exponent. Never uses floats or regex
 * (this runs once per cart line inside the Function, where instructions are scarce).
 * Throws on malformed input or values outside the safe integer range.
 */
export function parseDecimalToMinor(value: string | number, exponent: number): number {
  const str = typeof value === "number" ? numberToPlainString(value) : value.trim();
  const len = str.length;
  let i = 0;
  let negative = false;
  if (i < len && str.charCodeAt(i) === 45 /* - */) {
    negative = true;
    i++;
  }
  let minor = 0;
  let intDigits = 0;
  while (i < len) {
    const c = str.charCodeAt(i);
    if (c < 48 || c > 57) break;
    minor = minor * 10 + (c - 48);
    intDigits++;
    i++;
  }
  if (intDigits === 0) throw new Error(`Invalid decimal: ${String(value)}`);
  let fracDigits = 0;
  let roundUp = false;
  if (i < len) {
    if (str.charCodeAt(i) !== 46 /* . */ || i === len - 1) throw new Error(`Invalid decimal: ${String(value)}`);
    i++;
    while (i < len) {
      const c = str.charCodeAt(i);
      if (c < 48 || c > 57) throw new Error(`Invalid decimal: ${String(value)}`);
      if (fracDigits < exponent) minor = minor * 10 + (c - 48);
      else if (fracDigits === exponent) roundUp = c >= 53; /* '5' */
      fracDigits++;
      i++;
    }
  }
  for (let k = fracDigits; k < exponent; k++) minor *= 10;
  if (roundUp) minor += 1;
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: ${String(value)}`);
  return negative && minor !== 0 ? -minor : minor;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid decimal: ${String(n)}`);
  // Avoid exponent notation for small/large numbers.
  const s = String(n);
  if (s.indexOf("e") === -1) return s;
  let fixed = n.toFixed(20);
  while (fixed.endsWith("0")) fixed = fixed.slice(0, -1);
  return fixed.endsWith(".") ? fixed.slice(0, -1) : fixed;
}

const POW10 = [1, 10, 100, 1000];

/**
 * Fast path for parsing amounts that are already at currency precision (the normal
 * case for Shopify cart amounts): one native Number() parse and a scale. If the value
 * has more decimals than the currency allows, or is out of range, it falls back to the
 * exact string parser, so the result is always identical to parseDecimalToMinor.
 */
export function decimalToMinor(value: string | number, exponent: number): number {
  if (typeof value === "string" && !isPlainDecimal(value, exponent)) return parseDecimalToMinor(value, exponent);
  const n = typeof value === "number" ? value : Number(value);
  const scale = exponent < POW10.length ? POW10[exponent] : Math.pow(10, exponent);
  const scaled = n * scale;
  const rounded = Math.round(scaled);
  const diff = scaled - rounded;
  if (diff < 1e-7 && diff > -1e-7 && rounded <= 1e13 && rounded >= -1e13) {
    return rounded === 0 ? 0 : rounded;
  }
  return parseDecimalToMinor(value, exponent);
}

/**
 * Cheap shape check using native string methods: optional "-", digits, and an optional
 * "." followed by 1..exponent digits. Anything else (exponents, hex, spaces, extra
 * decimals) goes to the exact parser.
 */
function isPlainDecimal(s: string, exponent: number): boolean {
  const len = s.length;
  if (len === 0) return false;
  const first = s.charCodeAt(0);
  const start = first === 45 ? 1 : 0;
  const c0 = s.charCodeAt(start);
  if (c0 < 48 || c0 > 57) return false;
  const last = s.charCodeAt(len - 1);
  if (last < 48 || last > 57) return false;
  const dot = s.indexOf(".");
  if (dot !== -1 && (len - dot - 1 > exponent || s.indexOf(".", dot + 1) !== -1)) return false;
  // Number() also accepts these forms, which the strict parser rejects.
  return s.indexOf("e") === -1 && s.indexOf("E") === -1 && s.indexOf("x") === -1 &&
    s.indexOf("b") === -1 && s.indexOf("o") === -1 && s.indexOf(" ") === -1 && s.indexOf("-", 1) === -1 &&
    s.indexOf("_") === -1;
}

/**
 * Minor units → a JSON number in major units (e.g. 1235, exp 2 → 12.35). For values up
 * to 1e13 minor units the shortest round-trip representation JS prints is exactly the
 * decimal, so this is safe for output Decimals and much cheaper than string building.
 */
export function minorToNumber(minor: number, exponent: number): number {
  return exponent === 0 ? minor : minor / (exponent < POW10.length ? POW10[exponent] : Math.pow(10, exponent));
}

/** Format minor units as a plain decimal string with exactly `exponent` decimals. */
export function formatMinor(minor: number, exponent: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: ${minor}`);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  const intPart = exponent === 0 ? digits : digits.slice(0, -exponent);
  const frac = exponent === 0 ? "" : "." + digits.slice(-exponent);
  return (negative ? "-" : "") + intPart + frac;
}

/** Round a non-negative real to the nearest integer, halves up, tolerant of float noise. */
export function roundHalfUp(x: number): number {
  return Math.floor(Number(x.toFixed(6)) + 0.5);
}

/**
 * Convert an amount between currencies: shop minor units → cart minor units.
 * `rate` is Shopify's presentmentCurrencyRate (shop → presentment).
 */
export function convertMinor(
  amountMinor: number,
  fromCurrency: string,
  toCurrency: string,
  rate: number | string,
): number {
  const r = typeof rate === "string" ? Number(rate) : rate;
  if (!Number.isFinite(r) || r <= 0) throw new Error(`Invalid currency rate: ${String(rate)}`);
  const fromExp = currencyExponent(fromCurrency);
  const toExp = currencyExponent(toCurrency);
  if (r === 1 && fromExp === toExp) return amountMinor;
  const converted = roundHalfUp(amountMinor * r * Math.pow(10, toExp - fromExp));
  if (!Number.isSafeInteger(converted)) throw new Error("Converted amount out of range");
  return converted;
}
