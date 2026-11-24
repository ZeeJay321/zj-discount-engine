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

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parse a decimal string ("12.5", "6.0", "100") to integer minor units, rounding
 * half up on any digits beyond the currency's exponent. Never uses floats.
 * Throws on malformed input or values outside the safe integer range.
 */
export function parseDecimalToMinor(value: string | number, exponent: number): number {
  const str = typeof value === "number" ? numberToPlainString(value) : value.trim();
  const m = DECIMAL_RE.exec(str);
  if (!m) throw new Error(`Invalid decimal: ${String(value)}`);
  const negative = m[1] === "-";
  const intPart = m[2];
  const frac = m[3] ?? "";
  const kept = (frac + "0".repeat(exponent)).slice(0, exponent);
  const roundDigit = frac.length > exponent ? Number(frac[exponent]) : 0;
  let minor = Number(intPart + kept);
  if (roundDigit >= 5) minor += 1;
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: ${String(value)}`);
  return negative && minor !== 0 ? -minor : minor;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid decimal: ${String(n)}`);
  // Avoid exponent notation for small/large numbers.
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(20).replace(/\.?0+$/, "") : s;
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
