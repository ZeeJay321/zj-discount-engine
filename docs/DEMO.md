# Demo script (5–7 minutes)

## Store setup (before the talk)

Use a **partner development store** (Functions from custom apps do not run on ordinary trial/paid stores that are not Plus).

1. `shopify app dev` → install this app (`write_discounts`, `read_products`).
2. Confirm the rules page shows a development-store (or Plus) plan badge — not the red “won’t run” banner.
3. Catalog: at least one **collection** with 1–2 products priced in shop currency; optional second product outside the collection.
4. **Shipping:** at least two rates (e.g. Standard $5, Express $15) so free-shipping demos are visible.
5. Optional: one already-synced **amount-off** rule on the collection, and/or a **free shipping** rule at a clear threshold (e.g. $100), so you are not creating everything cold.
6. Online storefront (or a headless storefront pointed at the same shop) ready for checkout.

Quota headroom: keep under 25 automatic discounts so create/enable is not blocked.

---

## Beat 1 — Rules list (~45s)

Open **Rules** (`/app`).

Show: quota line (“X of 25 … from this app”), plan/currency note, product-rule caps line, rule table (type badge, sync status).

Mention: each row is one automatic app discount on Shopify.

---

## Beat 2 — Create a rule (~90s)

**New rule** → Amount off products (or Free shipping if shipping is the story).

- Title customers will see at checkout
- Collections / products via picker
- 10% off (or free shipping over threshold)
- Dates; leave combinations simple
- Save → status becomes **Synced**

Point out: type cannot be changed later (Shopify discount class).

---

## Beat 3 — Checkout (~90s)

Storefront: add an eligible product (and ineligible one if useful). Reach checkout (or cart with discounts visible).

Show the automatic discount applying with the rule title. For free shipping, cross the threshold and show delivery options discounted.

---

## Beat 4 — Simulator vs checkout (~90s)

Nav → **Simulator**.

- Load example cart **or** mirror the checkout cart (picker + qty + prices; collections on lines for collection rules; delivery options for shipping).
- Select the same rule(s); set “as of” to today.
- Per-rule total should match the Function maths (same `evaluateRule`).
- Call out the **combined estimate** block: greedy stack estimate; shipping separate; `TIER_BASIS` assumption — see [LIMITS.md](LIMITS.md) (**unverified** against live Shopify stack order unless you have confirmed it).

Nothing here writes to Shopify.

---

## Beat 5 — Sync failure and retry (~60s)

If you have a FAILED row from a prior bad sync, open it. Otherwise briefly explain: on failure the row is **FAILED**, Shopify keeps the last good metafield, UI offers **Retry sync** and **Revert to live version**.

Show Retry (or Revert) on the list or edit page. Ideal live fail is hard to force on a healthy store — saying “unverified live fail in this demo” is fine if you only walk the UI paths.

---

## Beat 6 — Cap behaviour (~45s)

Product rule + cart with **more lines than the type’s cap** (amount off 27, BOGO 26, bundle 21).

- Checkout / Function: no discount from that rule
- Simulator: reason `above_line_cap` with the cap number

Faster path: Simulator with many manual lines rather than building a 28-line checkout.

---

## Timing

| Beat | ~time |
|---|---|
| List | 0:45 |
| Create | 1:30 |
| Checkout | 1:30 |
| Simulator | 1:30 |
| Sync story | 1:00 |
| Cap | 0:45 |
| **Total** | **~7:00** |

Cut Beat 5 or shorten create if under 5 minutes.
