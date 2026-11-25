# Limits and design choices

Honest constraints from this repo — not a marketing list.

## Cart-line caps (product rules)

Shopify caps a Function at **11M instructions** for carts up to 200 lines (scales beyond that). The JS Function pays ~1M to start; per-line cost is dominated by reading input and writing output in the Wasm interpreter.

Caps in [`packages/discount-core/src/limits.json`](../packages/discount-core/src/limits.json) are the largest **worst-case** carts measured at ≤ ~50% of the limit (real-length IDs). **Above the cap the rule returns no discount at all** (Function and `evaluateRule` agree).

| Rule type | Cap | At-cap instruction share (measured) |
|---|---|---|
| Amount off products | **27** | ~49.5% (fixed-once worst case) |
| Buy X get Y | **26** | ~49.6% |
| Bundle | **21** | ~48.7% (fixed price, limit 100) |
| Tiered spend | none | ~11–72% at 1–200 lines (subtotal only; lines ignored) |
| Free shipping | none | no cart lines read |

CI: `node scripts/function-perf.mjs --gate 55` fails if a cart **at** a cap exceeds 55%. Re-measure with `--sweep` after temporarily raising caps (see README history in git if needed).

## Why JavaScript (and a Rust port)

JS was chosen so the Function and admin/simulator share **one TypeScript core** — identical per-rule maths, one language. The cost is interpreter overhead → line caps above.

To port **only the Function** to Rust later (not done in this repo):

1. Same handle `zj-discount-function` and input queries
2. Port money / allocate / rules / evaluate / schema to a crate; keep TS for admin + simulator
3. Read or raise `limits.json` after `--sweep`
4. Keep fixture + parity acceptance against the TS core

## Development / Plus only (custom apps)

Functions from custom-distribution apps run on **Shopify Plus or partner development stores**. The app queries `shop.plan { partnerDevelopment shopifyPlus }` ([`checkStore`](../app/services/store-check.server.ts)). Non-matching stores get a critical banner; rules can still sync but will not apply at checkout.

## Priority is not checkout stacking order

Same priority + overlapping date windows is rejected in UI and server. That only keeps the rule list sane. At checkout, Shopify combines separate automatic discounts using each discount’s **combination settings**, not this app’s priority field.

## Simulator combined total is an estimate

Per-rule totals use the same `evaluateRule` path as checkout.

The **combined** number in the simulator is a labelled estimate ([`simulate.ts`](../packages/discount-core/src/simulate.ts)):

- Greedy within each class (best-first); stack only when **both** rules allow that class
- Shipping in its own bucket (never folded into product/order money)
- End dates exclusive; disabled / out-of-window → skipped
- Product rules above cap → reason `above_line_cap`, $0

### `TIER_BASIS`

```ts
export const TIER_BASIS = "before_product_discounts";
```

When estimating order tiers / order % with product discounts also selected:

- `before_product_discounts` (default): order rules use the original cart subtotal
- `after_product_discounts`: order rules are re-evaluated on `max(0, subtotal − productTotal)`

**Checkout confirmation: unverified.** This doc pass did not record a real-store comparison of whether Shopify chooses the tier before or after product discounts. If a checkout run shows `after`, update **this document** (and optionally the constant later) — do not assume the default matches Shopify until verified.

## 25 automatic discounts per store

`AUTOMATIC_DISCOUNT_LIMIT = 25` in [`discount-quota.server.ts`](../app/services/discount-quota.server.ts). Counts **all** active or scheduled automatic discounts on the shop (every app + merchant). Create/enable is blocked at the limit. The rules page shows “X of 25 (Y from this app)”.

## Rule type fixed after creation

Each type maps to one Shopify discount class. Shopify cannot change class on an existing discount. Edit UI shows type read-only; server rejects type changes. Switch type = new rule + delete old.

## Multi-currency rounding

Thresholds and fixed amounts are stored in **shop currency** minor units. At evaluation they convert with Shopify’s `presentmentCurrencyRate` (half-up). Percentage discounts apply in the cart (presentment) currency. Fixtures cover JPY (0 dp) and KWD (3 dp) among others.

## Other practical limits

| Limit | Value |
|---|---|
| Collections per product-set rule | 50 |
| Products per product-set rule | 100 |
| Bundle components | 2–5 |
| Tiers | 2–5 |
| Priority | 0–1000 |
| Stale PENDING/DELETING retry | after 2 minutes (`STALE_AFTER_MS`) |
