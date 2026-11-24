/**
 * Allocation helpers. Both return integer shares that sum exactly to the intended
 * total, using the largest-remainder method (ties go to the earlier index, so the
 * result is deterministic).
 */

/**
 * Percentage of each line, with the *total* rounded half-up once and then split so
 * that the per-line amounts add up to it. Pure integer arithmetic.
 *
 * @param subtotals line subtotals, minor units (non-negative safe integers)
 * @param basisPoints percent × 100 (e.g. 12.5% → 1250), 0..10000
 */
export function allocatePercent(subtotals: readonly number[], basisPoints: number): number[] {
  const quotients: number[] = [];
  const remainders: number[] = [];
  let sumQ = 0;
  let sumR = 0;
  for (const s of subtotals) {
    // s * bp stays < 2^53 for s < ~9e11 minor units per line; guarded by callers.
    const product = s * basisPoints;
    const q = Math.floor(product / 10000);
    const r = product - q * 10000;
    quotients.push(q);
    remainders.push(r);
    sumQ += q;
    sumR += r;
  }
  // Round the total half-up: extra = round(sumR / 10000).
  const extra = Math.floor((sumR + 5000) / 10000);
  return distribute(quotients, remainders, extra, subtotals);
}

/**
 * Split `total` across weights proportionally (e.g. a once-per-order fixed amount
 * across eligible line subtotals). If total <= sum(weights), no share exceeds its weight.
 */
export function allocateProportional(total: number, weights: readonly number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sumW <= 0) return weights.map(() => 0);
  const quotients: number[] = [];
  const remainders: number[] = [];
  let sumQ = 0;
  for (const w of weights) {
    const exact = (total * w) / sumW;
    const q = Math.floor(exact);
    quotients.push(q);
    remainders.push(exact - q);
    sumQ += q;
  }
  const caps = total <= sumW ? weights : undefined;
  return distribute(quotients, remainders, total - sumQ, caps);
}

function distribute(
  quotients: number[],
  remainders: number[],
  extra: number,
  caps?: readonly number[],
): number[] {
  const out = quotients.slice();
  if (extra <= 0) return out;
  const order = remainders
    .map((r, i) => i)
    .sort((a, b) => remainders[b] - remainders[a] || a - b);
  let left = extra;
  // Normally one pass suffices; loop guards the capped case.
  while (left > 0) {
    let progressed = false;
    for (const i of order) {
      if (left === 0) break;
      if (caps && out[i] >= caps[i]) continue;
      out[i] += 1;
      left -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  return out;
}
