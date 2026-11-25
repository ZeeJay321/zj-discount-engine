# zj-discount-engine

Custom Shopify app: merchants define discount rules in an embedded admin UI; each rule syncs to an **automatic app discount** with a JSON metafield. A Shopify Function reads that metafield at checkout and applies the discount. All maths live in `@zj/discount-core` (pure TypeScript), shared by the Function and a browser-only **Simulator** at `/app/simulator`.

## Features

| Rule type | Class | Behaviour |
|---|---|---|
| Amount off products | PRODUCT | % or fixed amount off collection or product-list targets |
| Tiered spend | ORDER | 2–5 spend thresholds; highest reached tier discounts the order |
| Buy X get Y | PRODUCT | Every X+Y units in the set: Y cheapest units at a % off |
| Bundle | PRODUCT | 2–5 components; complete bundles get %, amount off, or fixed price |
| Free shipping | SHIPPING | Subtotal threshold; % off delivery options (optional max; all or cheapest) |

Also: atomic sync with retry/revert, measured per-type cart-line caps, schema versions v1–v5, browser cart simulator (estimate for stacked totals).

## Quick start

Needs **Node 22.12+** and the Shopify CLI (`npm i -g @shopify/cli`).

1. `npm install`
2. `shopify app dev` → pick a **development store** → install the app (`write_discounts`, `read_products`)
3. Open the app. The rules page shows the store plan; a red banner means the Function will not run (custom-app Functions need development or Plus).

**Env var names only** (see `.env.example`; never commit values): `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`, `NODE_ENV`. Locally Prisma uses SQLite (`prisma/dev.sqlite`).

## Commands

| Command | What it does |
|---|---|
| `npm test` | Core (95% coverage), app, and Function fixture + Wasm parity tests |
| `npm run typecheck` | React Router typegen + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `node scripts/function-perf.mjs --gate 55` | Fail if a cart at a product-rule cap uses >55% of the 11M instruction limit |
| `node scripts/function-perf.mjs --breakdown` | Instruction counts for `tests/perf` |
| `node scripts/function-perf.mjs --sweep` | Largest worst-case cart at ≤50% of the limit (for re-measuring caps) |
| `npm run graphql-codegen` | Validate Admin GraphQL against the 2026-10 schema |
| `node scripts/gen-function-fixtures.mjs` | Regenerate Function fixtures after changing `limits.json` |

## Docs

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, shared core, data model, sync, metafield schema versions |
| [docs/RULES.md](docs/RULES.md) | Five rule types: behaviour, validation, worked examples |
| [docs/LIMITS.md](docs/LIMITS.md) | Caps, store/platform limits, simulator estimate / `TIER_BASIS` |
| [docs/DEMO.md](docs/DEMO.md) | 5–7 minute demo script and store setup |
| [docs/TESTING.md](docs/TESTING.md) | Automated suites, perf gate, manual checks |

## Layout

```
app/                         React Router admin (Polaris web components)
  routes/app._index.tsx      rules list, store check, discount quota
  routes/app.rules.*.tsx     create / edit
  routes/app.simulator.tsx   browser-only cart simulator
packages/discount-core/      pure discount logic (Function + simulator)
  src/limits.json            measured MAX_CART_LINES per product type
  src/simulate.ts            simulate() + TIER_BASIS combination estimate
extensions/zj-discount-function/
  src/adapter.ts             Shopify input/output ⇄ core
  tests/fixtures/            hand-checked Function outputs
  tests/parity.test.js       Wasm ⇄ TypeScript
prisma/                      Rule, SyncEvent, Session (SQLite locally)
```

## Privacy

No customer PII in Rule/SyncEvent. Compliance webhooks are HMAC-verified; `shop/redact` deletes that shop’s rules, events, and sessions. Secrets stay out of git (`.env*` ignored except `.env.example`).

## What I’d do next

1. **Hosting** — long-running Node (e.g. Fly) + managed Postgres; template has a Dockerfile; Prisma needs a Postgres schema/migrations for production (not set up in this repo).
2. **Rust Function** — keep TS core for admin/simulator; port Function maths to raise cart-line caps (see [docs/LIMITS.md](docs/LIMITS.md)).
3. **Analytics** — discount usage / revenue attribution (not in repo).
4. **App listing** — move from custom distribution toward the Shopify App Store when ready.
