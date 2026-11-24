# zj-discount-engine

A Shopify app (custom distribution) with an embedded admin UI and custom discount
logic in a Shopify Function. Merchants write discount rules in the app. Each rule is
saved as an **automatic app discount**, with the rule's configuration stored in a JSON
metafield on that discount. The Function reads the metafield through its input query
and applies the discount at checkout.

**Status:** vertical slice. One rule type, *percentage or fixed amount off one or more
collections*, works end to end. Tiered spend, buy X get Y, bundles, free shipping and
the simulator are next.

## Layout

```
app/                         React Router admin app (Polaris web components)
  routes/app._index.tsx      rules list, store check, discount quota
  routes/app.rules.*.tsx     create / edit form
  services/                  sync service, Shopify GraphQL, quota, store check, compliance
  lib/rule-form.ts           form ⇄ rule draft, shared by browser and server
packages/discount-core/      PURE TypeScript discount logic: no I/O, shared by Function and app
  src/limits.json            MAX_CART_LINES (measured, see below)
extensions/zj-discount-function/
  src/*.graphql              input queries (kept minimal on purpose)
  src/adapter.ts             Shopify input/output ⇄ core types
  tests/fixtures/*.json      function-runner fixtures with hand-checked outputs
  tests/perf/*.json          large carts for instruction counting
  tests/parity.test.js       Wasm output must equal the same TS code run in Node
scripts/                     fixture generator, instruction-count tool
prisma/                      SQLite schema + migrations (Rule, SyncEvent, Session)
```

## Setup

You need Node 22.12 or later and the Shopify CLI (`npm i -g @shopify/cli`).

1. `npm install`
2. `shopify app dev`, then pick your **development store**. Install the app and accept
   the scopes `write_discounts` and `read_products`.
3. Open the app. The home page shows the store's plan. If it shows a red banner, the
   store isn't a development or Plus store, and the Function won't run there.

### Checking the store is a development store

Functions in custom-distribution apps only run on **Shopify Plus or development stores**.
There are two ways to check:

- The store admin shows a "Development store" banner, and the Dev Dashboard lists the
  store under **Stores** as a development store.
- The app checks for you: it queries `shop.plan { partnerDevelopment shopifyPlus }`. The
  rules page shows "(development store)" next to the plan, or a critical banner if
  neither flag is true.

### Environment variables (names only; never commit values)

`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`,
`NODE_ENV`. `shopify app dev` provides the Shopify ones. See `.env.example`.
Locally, Prisma uses the template's SQLite file (`prisma/dev.sqlite`).

## Commands

| Command | What it does |
|---|---|
| `npm test` | core tests with a 95% coverage gate, app tests, Function fixture and parity tests |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `node scripts/gen-function-fixtures.mjs` | regenerate Function fixtures (run after changing `limits.json`) |
| `node scripts/function-perf.mjs --breakdown` | instruction counts for `tests/perf`, plus input-parsing-only cost |
| `node scripts/function-perf.mjs --sweep` | find the largest worst-case cart at ≤ 50% of the limit |
| `node scripts/function-perf.mjs --gate 55` | fail if a cart at the cap uses more than 55% of the limit (runs in CI) |
| `npm run graphql-codegen` | validate the app's Admin GraphQL documents against the 2026-10 schema |

## How a rule reaches checkout

1. **Saving a rule** validates it (the same `validateRule` runs in the browser and on
   the server) and writes the row with status `PENDING`.
2. **One** `discountAutomaticAppCreate` / `discountAutomaticAppUpdate` call sends the
   title, dates, combination settings, `discountClasses` and the `$app` / `rule-config`
   JSON metafield **together**. Either both are saved or neither is.
3. On success the row becomes `SYNCED`, and the state Shopify accepted is stored as
   `syncedConfig`. On failure the row becomes `FAILED` with the error. Shopify keeps
   the previous version, so the local rule can't silently drift. The UI offers
   **Retry sync** or **Revert to live version**.
4. **Crash safety:** if Shopify created the discount but the app never stored its ID,
   the next retry finds it by the `ruleId` inside its metafield and links it instead of
   creating a duplicate. Rows stuck in `PENDING` or `DELETING` for more than 2 minutes
   are retried when the rules list loads.
5. **Disabling** a rule sends it to Shopify as already ended, so Shopify shows it as
   expired. **Enabling** sends the real dates again. Both use the same single update
   call.

### Dates are enforced by Shopify, not the Function

The rule's start and end dates are set on the Shopify discount (`startsAt` / `endsAt`),
and Shopify only runs the Function while the discount is active. **The Function never
checks dates.** The `now` parameter in `@zj/discount-core` (`isActiveAt`) exists only
for the simulator, to decide which rules would be live at a chosen time. The parity
test compares like with like: the same input through the Wasm and through
`adapter + core`, with no date filtering on either side.

### Limits the app enforces

- **25 active automatic discounts per store**, counting every app's and the merchant's
  own. A 26th is not applied at checkout. The rules page shows "X of 25 (Y from this
  app)", and creating or enabling a rule is blocked at 25. The count includes scheduled
  discounts, so the app may block slightly early but never late.
- **Same priority, overlapping dates:** this is rejected in the UI and on the server.
  Priority can't be enforced across separate discounts at checkout: Shopify combines
  discounts according to each discount's combination settings.

## The cart-line cap (`MAX_CART_LINES = 30`)

Shopify stops a Function at **11M instructions** for carts up to 200 lines (the limit
scales up linearly beyond that). The JavaScript Function costs about 1M instructions to
start, plus a per-line cost that is dominated by reading Shopify's input and writing
the output inside the Wasm JavaScript interpreter.

Measured with `scripts/function-perf.mjs` (15% off; the cap row is the worst case of 15% off and a fixed
amount once per order, with every line eligible):

| Cart | Before optimising | After optimising |
|---|---|---|
| 200 lines, half eligible | 26,110,413 (237%) | 17,590,038 (160%) |
| 250 lines × 999 qty | 32,698,200 (238%) | 22,057,574 (160%) |
| 200 lines, input parsing only | 9,229,852 (84%) | 6,446,560 (59%) |
| 1 line | 1,011,231 (9%) | 1,020,313 (9%) |
| **30 lines, all eligible (cap)** | n/a | **≈5.0M (45.6%)** |

The sweep found **33 lines** to be the largest worst-case cart at or below 50% of the
limit. The cap is set to **30** to leave margin for real carts, whose line IDs and
amounts can be longer than the fixtures'. The value lives in
`packages/discount-core/src/limits.json` and is exported as `MAX_CART_LINES`.

**Above the cap, a rule gives no discount at all, never a partial one.** The Function
checks the raw line count first and returns no operations; core's `evaluateRule` does
the same, so the simulator agrees. A cart above the cap still costs about 58% of the
limit just to read, so large carts never fail; they simply get no discount. The cap is
shown in the rule form and on the rules page. CI fails if a cart at the cap goes over
55%.

Optimisations already made:
- the input query only asks for line id, quantity, subtotal and `inAnyCollection`
- the currency is read once per cart
- the metafield is parsed once
- lines outside the collections are skipped before any parsing
- decimals are parsed without regex
- there are no JS comparator sorts on the hot path
- output amounts are numbers, with no per-line message

### Why JavaScript, and how to move to Rust later

JavaScript lets the Function and the admin share **one TypeScript implementation** of
the discount logic, so the simulator and checkout give identical results, and the team
works in one language. The cost is the interpreter overhead above, which is why there's
a cap. A Rust Function reads input lazily and runs natively compiled code, so it would
allow much larger carts.

To port **only the Function** to Rust later:
1. Generate a Rust discount extension with the same handle (`zj-discount-function`)
   and the same input query.
2. Port `packages/discount-core/src/{money,allocate,rules,evaluate,schema}.ts` to a
   crate. Keep the TS core for the admin and simulator.
3. Read `limits.json` for the cap (or raise it after measuring with
   `function-perf.mjs --sweep`).
4. Acceptance: every JSON fixture in `tests/fixtures` and `tests/perf` must give the
   same output. Point `parity.test.js` at the Rust build so it checks the Rust
   Function against the TS core.

## Privacy

- No customer personal data is stored. Rules only reference collection IDs. Sessions
  use offline tokens, so the staff name and email columns stay empty.
- The compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
  are HMAC-verified and return 200. `shop/redact` deletes the shop's rules, sync events
  and sessions.
- No secrets are in git; `.env*` is ignored except `.env.example`.

## Production hosting (recommendation only; not set up)

- **App:** a long-running Node host such as Fly.io. The template ships a Dockerfile.
  An always-on machine avoids cold starts on admin loads and webhooks.
- **Database:** managed Postgres, such as Neon (backups and point-in-time restore;
  branches for CI). SQLite on a single machine has no failover and makes backups
  fragile.
- **Prisma caveat:** the provider can't be switched with an env var. Production needs
  a Postgres schema and its own migrations (generated from the SQLite schema), with CI
  running migrations against Postgres.
- **Env:** the variables above, plus `DATABASE_URL` (and a direct URL for migrations).
  Store them as host secrets.
