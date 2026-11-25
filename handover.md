# Handover for Claude

Short context so the next session can continue without re-deriving the project.

## What this is

Shopify **custom-distribution** app: admin rules → automatic app discounts + `$app`/`rule-config` metafield → **Shopify Function** at checkout. Pure maths in `@zj/discount-core` (shared by Function + browser simulator).

Start here: [README.md](README.md) → [docs/](docs/). Shopify API work: use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) per [AGENTS.md](AGENTS.md) — do not add toolkit tooling into this repo.

## Current status (2026-11-25)

| Area | State |
|---|---|
| Five rule types | Done end-to-end (amount off, tiered, BOGO, bundle, free shipping) |
| Sync | Atomic create/update, retry, revert, reconcile (2 min stale) |
| Simulator | Done: `/app/simulator`, `simulate()`, `TIER_BASIS` |
| Docs | Done under `docs/` + slim README (may be **uncommitted** — check `git status`) |
| Hosting / Rust / analytics / App Store | Not built (“What I’d do next” in README) |

Recent commits on `main` (already pushed / local): free shipping + Combinations checkbox fix; rules UI; **simulator** (`82a1fcb`). Docs (`README.md` + `docs/`) may still be unstaged.

## Layout (where to look)

```
app/routes/app._index.tsx      rules list
app/routes/app.rules.*.tsx     create/edit
app/routes/app.simulator.tsx   simulator loader
app/components/simulator/      client cart + results
app/services/discount-sync.server.ts
packages/discount-core/src/    evaluate, validate, schema v5, simulate, limits.json
extensions/zj-discount-function/  adapter + dual targets (lines + delivery)
docs/                          ARCHITECTURE, RULES, LIMITS, DEMO, TESTING
```

## Hard rules for agents

- **Do not commit** unless the user explicitly asks.
- **Do not change Function/sync behaviour** casually; leave live store rules alone unless asked.
- **Do not change `TIER_BASIS`** without an explicit checkout confirmation + user ask. Default in code: `before_product_discounts`. Docs mark live Shopify stack order as **unverified** ([docs/LIMITS.md](docs/LIMITS.md)).
- Money = integer minor units; no floats in core hot paths.
- Rule **type is fixed** after create (Shopify discount class).
- Free shipping: `combinesWith.shippingDiscounts` must stay **false** (validate + sync force).
- Product rules above per-type line caps → **no** discount (not partial). Caps in `limits.json`: 27 / 26 / 21.

## Commands

```bash
npm test                          # core + app + Function fixtures/parity
npm run typecheck && npm run lint
node scripts/function-perf.mjs --gate 55
shopify app dev                   # development store only for Functions
```

Function Wasm tests need a real Function build (network/all perms if sandbox blocks codegen).

## Open / unverified

- Real-checkout confirmation of whether tier thresholds use subtotal **before** or **after** product discounts → update LIMITS (and only then consider changing `TIER_BASIS`).
- Manual demo-store checklist in [docs/TESTING.md](docs/TESTING.md) left as operator-unverified.
- Production Postgres/Fly not set up; local Prisma is SQLite.

## Likely next asks

1. Commit docs (message already suggested: `Document architecture, rules, limits, demo, and testing in docs/`)
2. Confirm `TIER_BASIS` on a real cart and update LIMITS / constant
3. Hosting, Rust Function port, analytics, App listing (see README “What I’d do next”)
4. Screenshots listed at end of the docs implementation chat (rules list, checkout, simulator, FAILED retry, above-cap)

## Docs map

| File | Use when |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Mermaid, sync, schema v1–v5, data model |
| [docs/RULES.md](docs/RULES.md) | Per-type behaviour + fixture examples |
| [docs/LIMITS.md](docs/LIMITS.md) | Caps, quota 25, Plus/dev, simulator estimate |
| [docs/DEMO.md](docs/DEMO.md) | 5–7 min demo script |
| [docs/TESTING.md](docs/TESTING.md) | What tests cover |

## UI gotchas already fixed

- React 18 + Polaris: use shared [`Checkbox`](app/components/Checkbox.tsx) / [`Select`](app/components/Select.tsx) (property sync + FormData hidden input for checkboxes). Simulator adds optional controlled `onChange` on Checkbox.
- Embedded nav: use `AppLink` / `useAppNavigate`, not raw full-page hrefs.
