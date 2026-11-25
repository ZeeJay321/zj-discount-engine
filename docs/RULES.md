# Rule types

Money in examples is **minor units** (USD cents unless noted). Sources are Function fixtures checked by core parity tests.

Validation lives in [`packages/discount-core/src/validate.ts`](../packages/discount-core/src/validate.ts). The same `validateRule` runs in the browser and on the server.

---

## Amount off products

| | |
|---|---|
| **Type** | `AMOUNT_OFF_PRODUCTS` |
| **Class** | PRODUCT |
| **Cart-line cap** | 27 (above → no discount) |

**Behaviour:** Discounts lines in the rule’s product set: collections (any of) or an explicit product list. Percentage: one half-up round of the eligible subtotal, then allocated across lines. Fixed amount: shop-currency minors converted with `presentmentCurrencyRate`; either once across eligible lines or per item.

**Validation (summary):**

- Target: 1–50 collections or 1–100 products; valid GIDs; no duplicates
- Percentage: 0 &lt; percent ≤ 100, at most 2 decimal places
- Fixed: positive amount in shop currency; `appliesToEachItem` true/false
- Title, dates, priority 0–1000; same-priority overlapping dates rejected against other rules

**Worked example** ([`lines-percent-collection.json`](../extensions/zj-discount-function/tests/fixtures/lines-percent-collection.json)):

- Cart: line 1 = 2 × $10.00 in collection; line 2 = 1 × $9.99 in collection; line 3 outside collection
- Rule: 10% off collections
- Result: $2.00 + $1.00 → **totalMinor 300**

---

## Tiered spend

| | |
|---|---|
| **Type** | `TIERED_SPEND` |
| **Class** | ORDER |
| **Cart-line cap** | none (uses cart subtotal only) |

**Behaviour:** 2–5 tiers with rising spend thresholds (shop currency). Highest tier whose threshold the subtotal reaches applies (exactly at threshold counts). Percentage tiers → order %; fixed tiers → converted amount clamped to subtotal.

**Validation (summary):**

- 2–5 tiers; thresholds &gt; 0, strictly increasing
- All tiers same value kind (all % or all fixed)
- Percentage / fixed values must not decrease as tiers rise; fixed amount ≤ that tier’s threshold
- Currency code required

**Worked example** ([`tiered-at-second.json`](../extensions/zj-discount-function/tests/fixtures/tiered-at-second.json)):

- Subtotal $200.00; tiers $100→10%, $200→15%, $300→20%
- Result: second tier → **15%**, **totalMinor 3000**

---

## Buy X get Y

| | |
|---|---|
| **Type** | `BUY_X_GET_Y` |
| **Class** | PRODUCT |
| **Cart-line cap** | 26 |

**Behaviour:** Units in the product set form groups of size buyQuantity + getQuantity. Number of sets = floor(units / (X+Y)), capped by `limitPerOrder`. Discount applies to the cheapest Y×sets units at the configured percent (100% = free).

**Validation (summary):**

- Same product-set rules as amount off
- `buyQuantity`, `getQuantity`: 1–100
- `percent`: 0 &lt; percent ≤ 100
- `limitPerOrder`: 1–100

**Worked example** ([`bogo-3-units.json`](../extensions/zj-discount-function/tests/fixtures/bogo-3-units.json)):

- Buy 2 get 1 free; one line qty 3 × $10.00 in set
- One set → 1 unit free → **totalMinor 1000**

---

## Bundle

| | |
|---|---|
| **Type** | `BUNDLE` |
| **Class** | PRODUCT |
| **Cart-line cap** | 21 |

**Behaviour:** 2–5 components (whole product or specific variant × quantity 1–10). Complete bundles = min over components of floor(available / required), capped by `limitPerOrder`. Within a component, cheapest units fill the bundle first. Value: % off those units, fixed amount off per bundle, or fixed bundle price (discount = price − fixed price when positive).

**Validation (summary):**

- 2–5 components; no duplicate IDs; cannot list a product and one of its variants as separate components
- Component quantity 1–10; `limitPerOrder` 1–100
- Value: percentage, fixed amount, or fixed price (shop currency for money kinds)

**Worked example** ([`bundle-one.json`](../extensions/zj-discount-function/tests/fixtures/bundle-one.json)):

- Components: Product/1 ×1 + Product/2 ×1; 20% off; lines $30 + $50
- One complete bundle → $6 + $10 → **totalMinor 1600**

---

## Free shipping

| | |
|---|---|
| **Type** | `FREE_SHIPPING` |
| **Class** | SHIPPING |
| **Cart-line cap** | none |

**Behaviour:** If cart subtotal (shop currency, via rate) ≥ threshold, apply `percent` (1–100) to delivery options. Optional `maxAmountMinor` clamps per option (then sent as fixed amount). `appliesTo`: `ALL` options, or `CHEAPEST` per delivery group (ties: earlier option).

**Validation / sync notes:**

- Threshold &gt; 0; percent in range; optional max
- **Cannot combine with other shipping discounts** — validate rejects `combinesWith.shippingDiscounts`; sync forces it `false`

**Worked example** ([`ship-at-threshold.json`](../extensions/zj-discount-function/tests/fixtures/ship-at-threshold.json)):

- Subtotal $100.00; threshold $100; 100% off; options $5.00 + $15.00
- Result: **totalMinor 2000**, two shipping lines

---

## Shared rules

- **Type fixed after create** — Shopify cannot change a discount’s class; edit form type is read-only; change type = new rule + delete old.
- **Dates** — Shopify enforces on the discount; Function does not check dates; simulator uses `isActiveAt` (end exclusive).
- **Combinations** — `combinesWith` product / order / shipping flags go to Shopify; stacking at checkout follows Shopify, not app priority.
