# Testing

## Automated suites

`npm test` runs three workspaces in order.

### Core (`npm run test:core`)

[`packages/discount-core`](../packages/discount-core) — Vitest + **95%** coverage gate.

Covers: money / allocate, `evaluateRule` for all five types, `validateRule`, metafield parse (schema v1–v5), `isActiveAt`, `simulate` (dates, caps, combine estimate, `TIER_BASIS` options, property tests), and **Function drift guard** [`simulate-parity.test.ts`](../packages/discount-core/test/simulate-parity.test.ts): one fixture per rule type, cart built like the Function adapter, `simulate` totals match fixture amounts.

### Function (`npm run test:function`)

[`extensions/zj-discount-function/tests`](../extensions/zj-discount-function/tests):

| Suite | What |
|---|---|
| `default.test.js` | Builds the Wasm Function; each `tests/fixtures/*.json` must produce the fixture’s expected output |
| `parity.test.js` | Same inputs through Wasm and through Node (`adapter` + core); outputs must match (fixtures + perf carts) |

Dates are not applied on either side of parity (Function never checks dates).

### App (`npm run test:app`)

Vitest over `app/**/*.test.ts`: rule form parse/dates, discount sync (atomic path, retry, revert, reconcile, free-shipping combines force-false), quota (`AUTOMATIC_DISCOUNT_LIMIT = 25`), public offers / related services.

## Perf gate

```bash
node scripts/function-perf.mjs --gate 55
```

Fails CI-style if a product-rule cart **at its measured cap** uses more than **55%** of the 11M instruction limit. Also useful: `--breakdown`, `--sweep` (re-measure caps; see [LIMITS.md](LIMITS.md)).

## Other checks in repo scripts

| Command | Role |
|---|---|
| `npm run typecheck` | `react-router typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run graphql-codegen` | Admin GraphQL vs 2026-10 schema |
| `node scripts/gen-function-fixtures.mjs` | Regenerate fixtures after `limits.json` changes |

## Manual / dev-store checks

Checklist derived from the README and [DEMO.md](DEMO.md). Mark results yourself; items not recorded in-repo stay **unverified** until you run them.

| Check | Expected | Status in docs |
|---|---|---|
| `shopify app dev` on a **development** store; app installs | Rules page loads | unverified (operator) |
| Plan badge vs red “won’t run” banner | Matches `partnerDevelopment` / `shopifyPlus` | unverified (operator) |
| Create rule → **Synced**; appears under Shopify Discounts | Metafield present; deep-link from Discounts opens edit | unverified (operator) |
| Eligible cart at checkout shows discount | Function applies | unverified (operator) |
| Simulator per-rule total vs same cart at checkout | Same maths | unverified (operator) |
| Simulator combined estimate vs stacked Shopify total | May differ — estimate + `TIER_BASIS` | **`TIER_BASIS` vs live stack: unverified** |
| FAILED → Retry / Revert | Restores sync or local desired state | unverified (operator) |
| Product cart above line cap | No discount; simulator `above_line_cap` | unverified (operator) |
| Free shipping above threshold | Delivery options discounted | unverified (operator) |

Automated tests in CI are the source of truth for maths and sync logic; the table above is for live-store confidence only.
