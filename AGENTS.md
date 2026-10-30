# TradeCRM Backend — AGENTS.md

## Commands

| Command | Purpose |
|---|---|
| `npm run start:dev` | Dev server with hot-reload (Nest watch mode) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run production build from `dist/` |
| `npm run prisma:generate` | Generate Prisma client from schema |
| `npm run prisma:migrate` | Apply pending migrations (dev) |
| `npm run prisma:seed` | Seed DB via `ts-node prisma/seed.ts` |
| `npm run prisma:studio` | Open Prisma Studio GUI |
| `npm run prisma:deploy` | `prisma migrate deploy` — apply migrations in CI/prod |
| `npm test` (or `npx jest`) | Run unit tests (jest + ts-jest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:cov` | Run tests with coverage |
| `npx tsc --noEmit -p tsconfig.build.json` | Typecheck (full strict) |

- `build` = `prisma generate && nest build`; `postinstall` = `prisma generate`.
- `npm start` runs `node dist/src/main` — note the `dist/src/` path.

## Testing

- Unit tests use **jest + ts-jest** (`jest.config.js`), no DB access — Prisma is mocked.
- `jest.config.js`: `rootDir: 'src'`, `testRegex: '.*\\.spec\\.ts$'`, `clearMocks: true`, coverage output `../coverage`.
- Specs live next to sources as `*.spec.ts`; `tsconfig.build.json` excludes them from the build.
- 13 spec files cover:
  - `analytics/analytics.service.spec.ts` (sales velocity, stock health, reorder priority, debtor risk, period comparisons)
  - `auth/strategies/jwt.strategy.spec.ts` (60s user cache & deleted-user eviction)
  - `common/interceptors/idempotency.interceptor.spec.ts` (`Idempotency-Key` deduplication & replay)
  - `common/services/throttler-storage.service.spec.ts` (Postgres rate-limit storage)
  - `common/utils/period.util.spec.ts` (UTC period window resolution & previous-period calculation)
  - `dashboard/dashboard.service.spec.ts` (stats, revenue trend, payment distribution, sub-service orchestration)
  - `debtors/debtors.service.spec.ts` (debtor CRUD, summary metrics, credit profile)
  - `health/health.controller.spec.ts` (DB up/down probe)
  - `markets/markets.service.spec.ts` (**IDOR scoping** on update/remove)
  - `products/products.service.spec.ts` (stock journal on create/restock/write-off/adjust, archive, bulk price, summary, market scoping)
  - `products/dto/query-product.dto.spec.ts` (`?flag=false` parsing, rolling-window range)
  - `transactions/transactions.service.spec.ts` (role restrictions, debtor IDOR, pricing/discount/markup, atomic stock decrement, full & partial refunds, stock journal SALE/REFUND/VOID, archived products)
  - `users/users.service.spec.ts` (last-admin protection on remove/demote)

## CI

`.github/workflows/ci.yml` — job `typecheck-test`, on push to `main` and all PRs. Node 22, Postgres 16 service container. Steps in order:

`npm ci` → `npx prisma generate` → `npx tsc --noEmit -p tsconfig.build.json` → `npm test` → `npx prisma migrate deploy` → `npm audit --omit=dev --audit-level=high`

- `package.json` maintains `"overrides"` (currently `multer: ^2.5.0`, `js-yaml: ^5.5.0`) so transitive dependencies inside `@nestjs/platform-express` and `@nestjs/swagger` pass `npm audit --omit=dev --audit-level=high`.

## TypeScript strictness

`strict`, `strictNullChecks`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames` are ON. `strictPropertyInitialization` is **off** (DTO/entity classes rely on it). Target `ES2023`, module `commonjs`. Not enabled: `noUnusedLocals`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`.

## Prisma v7 + Postgres adapter

- Prisma client is generated to `node_modules/@prisma/client` (default output of `prisma generate` in v7).
- Import `Prisma` namespace / client types from `@prisma/client` (not `prisma/generated/` — that folder is legacy and stale).
- `PrismaService` uses `@prisma/adapter-pg` — the adapter is constructed with the raw `DATABASE_URL` env var, not via PrismaClient's `datasources`.
- DB config: `prisma.config.ts` (Prisma v7 config file format, not `prisma/schema.prisma` for datasource URLs).
- Migrations: the repo has no `prisma/migrations/` yet; schema changes ship as idempotent SQL in `prisma/sql/` (run with an `npm run db:*` script) and must leave the DB identical to what `prisma db push` would create.
- **Stock journal migration**: `npm run db:stock-movements` (`prisma/sql/20261029_stock_movements.sql`) — creates `StockMovement`, adds `Product.isActive/archivedAt`, backfills each non-zero stock as an `OPENING` movement. Safe to re-run; keeps all data.
- Run `prisma generate` after any schema change (`npm run prisma:generate`), otherwise `npx tsc` will fail against stale types.
- Models: `User, Market, Category, Product, StockMovement, Debtor, Transaction, TransactionItem, Payment, SellerCredit, ThrottleBucket, IdempotencyKey`.
- `Transaction` has a self-relation for refunds (`refundOfId String?`, relation `"TransactionRefund"`), plus composite indexes `@@index([marketId, type, createdAt])` and `@@index([createdById, type, createdAt])`.
- `TransactionItem` stores `price`, `discount`, `markup`, `totalPrice`, `refundedQuantity`, and `refundOfItemId` to support line-level discounts/markups and partial refunds.
- `PrismaService.onModuleInit()` sweeps stale `ThrottleBucket` rows and expired `IdempotencyRecord` rows (`expiresAt < now()`), wrapped in try/catch so a missing migration doesn't crash boot.
- Enums are duplicated (Prisma schema + `src/enums/`) and are kept **in sync**: `Role`, `TransactionType`, `PaymentType`, `TransactionStatus` (includes `PARTIALLY_REFUNDED`). `AnalyticsPeriod` (`src/common/dto/period-query.dto.ts`, lowercase `today | week | month | year`) is DTO-only.

## Architecture

- **NestJS v11** (Express platform). Root module: `src/app.module.ts`
- **Two entry points, one app config:**
  - Local dev/prod: `src/main.ts` — boots via `bootstrap()`, calls `configureApp(app)`, listens on `PORT`.
  - Vercel serverless: `api/index.ts` — creates the app once with `ExpressAdapter(express())`, reuses it across warm invocations, exports `default async function handler(req, res)` that pipes into the Express instance. `vercel.json` rewrites `/(.*)` → `/api/index`.
  - **All app-wide configuration lives in `src/bootstrap.ts` → `configureApp(app)`** (trust proxy, helmet, compression, 100kb body limit, `/api` prefix, CORS, global ValidationPipe, dev-only Swagger). Both entry points must use it — keep new middleware/guards there. `main.ts` stays ~23 lines and adds no config of its own.
  - One deliberate exception: `app.enableShutdownHooks()` is called **only** in `main.ts`. Vercel must not call it — it would kill the Prisma pool on warm reuse (see the note in `api/index.ts`).
- All API routes prefixed with `/api`. Swagger at `/api/docs` (dev only).
- **Global auth** — `JwtAuthGuard` + `RolesGuard` registered app-wide in `AuthModule`.
  - Bypass with `@Public()` decorator.
  - Require roles with `@Roles(Role.ADMIN)` etc.
  - Access user via `@CurrentUser()` param decorator (returns `JwtPayload` or a key thereof).
- **Global `ThrottlerGuard`** via `APP_GUARD` — see Rate limiting below.
- **Global response format** (via `TransformInterceptor`): `{ success: true, data, timestamp }`
- **`LoggingInterceptor`** is also registered in `CommonModule`.
- **Global exception filter** catches all unhandled errors.
- **ValidationPipe** globally (whitelist, forbid non-whitelisted, auto-transform).
- **File uploads & `@UploadImage()` decorator**:
  - `StorageService` uploads to **Cloudinary** (`cloudinary` v2, configured from `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`).
  - Controllers use the composite `@UploadImage(fieldName = 'image')` decorator (`src/common/decorators/upload-image.decorator.ts`), which wraps `FileInterceptor` (`memoryStorage()`, 5MB limit, `imageFileFilter` for jpg/png/webp/gif) + `@ApiConsumes('multipart/form-data')`. Do not duplicate `UseInterceptors(FileInterceptor(...))` in controllers.
- **Idempotency (`@Idempotent()`)**:
  - `IdempotencyInterceptor` (`src/common/interceptors/idempotency.interceptor.ts`) deduplicates mutating requests carrying an `Idempotency-Key` header via the `IdempotencyRecord` table (scoped by `userId + method + path + key`, 24h TTL).
  - Applied via `@Idempotent()` on offline-capable mutations: `POST /debtors`, `POST /transactions`, `PATCH /transactions/:id/pay`, `POST /transactions/:id/refund`.

### Registered modules

`app.module.ts` registers, in order: `PrismaModule, AuthModule, CommonModule, AnalyticsModule, UsersModule, MarketsModule, ProductsModule, ProfileModule, SellersModule, DebtorsModule, TransactionsModule, DashboardModule, HealthModule`.

### Endpoint map

All paths below are under the `/api` prefix.

| Module | Prefix | Class-level `@Roles` | Endpoints |
|---|---|---|---|
| products | `products` | ADMIN, OWNER, SELLER | `POST /` (multipart, **ADMIN+OWNER**), `GET /` (metrics + filters), `GET /:id`, `PATCH /:id` (multipart, **ADMIN+OWNER**), `POST /:id/restock` (**ADMIN+OWNER**), `DELETE /:id` (**ADMIN+OWNER**) |
| markets | `markets` | ADMIN, OWNER | `POST /` (multipart, **ADMIN only**), `GET /`, `GET /:id`, `GET /:id/full`, `PATCH /:id` (multipart, ADMIN+OWNER), `DELETE /:id` (**ADMIN only**) |
| sellers | `sellers` | OWNER, ADMIN | `POST /` (multipart), `GET /`, `GET /:id`, `GET /:id/full`, `PATCH /:id` (multipart), `DELETE /:id` |
| debtors | `debtors` | none (SELLER allowed) | `POST /` (`@Idempotent()`), `GET /`, `GET /:id`, `GET /:id/full`, `PATCH /:id`, `DELETE /:id` (**ADMIN+OWNER**) |
| profile | `profile` | none (any authed user) | `GET /`, `PATCH /` (multipart), `PATCH /password` |
| users | `users` | ADMIN | `POST /` (multipart), `GET /`, `GET /:id`, `GET /:id/full`, `PATCH /:id` (multipart), `DELETE /:id` |
| transactions | `transactions` | none (SELLER allowed, restricted in service) | `POST /` (`@Idempotent()`), `GET /` (+`summary`), `GET /:id`, `PATCH /:id` (**ADMIN+OWNER**), `DELETE /:id` (**ADMIN+OWNER**), `PATCH /:id/pay` (`@Idempotent()`), `POST /:id/refund` (`@Idempotent()`, **ADMIN+OWNER**) |
| dashboard | `dashboard` | ADMIN, OWNER | `GET /`, `GET /sellers-report` |
| health | `health` | `@Public()` | `GET /` → `{status, database, timestamp}`; `SELECT 1` probe, 503 on failure |

### Shared domain helpers & service decomposition

- **Period utilities (`src/common/utils/period.util.ts`)**: `resolvePeriod(period, now?)` and `previousPeriod(window)` are the single source of truth for UTC period windows (`today`, `week`, `month`, `year`) across `AnalyticsService` and `DashboardService`.
- **Analytics module (`src/analytics/analytics.service.ts`)**: enriches products (sales velocity, days of stock, return rate, stock health, reorder priority), debtors (overdue days, payment discipline, risk level, credit profile), sellers (period performance & rankings), and markets (period KPIs).
- **Dashboard sub-services (`src/dashboard/`)**:
  - `DashboardService` (`dashboard.service.ts`) — top-level orchestrator and date-window resolver
  - `DashboardMetricsService` (`dashboard-metrics.service.ts`) — KPI counts, period comparison, revenue trend (`$queryRaw`), payment distribution
  - `DashboardInsightsService` (`dashboard-insights.service.ts`) — inventory health summary, debtor aging buckets, top products
  - `DashboardAnalyticsService` (`dashboard-analytics.service.ts`) — pulse, cashflow, profit/discount summary, weekday chart, hourly heatmap
  - `DashboardSellersService` (`dashboard-sellers.service.ts`) — seller leaderboard & `/dashboard/sellers-report` attribution
  - `dashboard.types.ts` — shared query row interfaces and `round2` helper
- **Transactions domain helpers (`src/transactions/`)**:
  - `transactions-pricing.util.ts` — `validateAndComputeItems` (DB price lookup, discount/markup validation), `selectRefundItems`, `computeProportionalRefundAmount`
  - `transactions-enrichment.util.ts` — `enrichTransaction`, `enrichManyTransactions`, `computeTransactionsSummary`
- **Debtors domain helpers (`src/debtors/debtors-metrics.util.ts`)**:
  - `buildEmptyStats`, `finalizeDebtorStats`, `buildDebtorSummary`, `computeCreditProfile`

## Market scoping / IDOR rule (MUST follow)

> Every read/write of a market-owned entity passes the caller's `marketId` down to the service, and a cross-market hit throws **`NotFoundException`, never `ForbiddenException`** — so record existence is not leaked.

- Controllers compute scope as `user.role === Role.OWNER ? user.marketId : undefined` (ADMIN is unscoped).
- Enforced in `markets.service.ts`, `products.service.ts` (`getProductOrThrow` / `restock`), `debtors.service.ts`, `sellers.service.ts`, `transactions.service.ts`.
- Enforce it inside raw SQL too — e.g. `products.service.ts` and `dashboard-*.service.ts` push `marketId` into `$queryRaw` conditions.
- Regression tests: `markets.service.spec.ts` → `describe('MarketsService (IDOR scoping)')`, `products.service.spec.ts`, `transactions.service.spec.ts`.

## Pagination / filter / sort convention

`BaseQueryDto` (`src/common/dto/base-query.dto.ts`): `page` (min 1, default 1), `limit` (1–100, default 20), `search` (max 200 chars), `dateFrom`/`dateTo` (ISO), `sortBy`, `sortOrder` (`'asc' | 'desc'`, default `'desc'`).

Helpers in `src/common/utils/paginate.util.ts`:

- `paginate()` — hard-caps limit at 100 server-side regardless of the DTO; returns `{ data, meta: { page, limit, total, totalPages } }`.
- `buildOrderBy(sortBy, sortOrder, defaultSortBy = 'createdAt', allowedSortBy?)` — **always pass the allow-list**. Unknown keys silently fall back to the default, which blocks column enumeration.
- `buildDateWhere(dateFrom, dateTo)` → `{ gte?, lte? }`.

## Rate limiting

- Global `ThrottlerGuard` registered via `APP_GUARD` in `app.module.ts`. Default limit **100 req / 60 s per IP**.
- Storage is `PrismaThrottlerStorage` backed by Postgres (`ThrottleBucket` table), so limits hold **across serverless instances**.
- The storage does the whole hit/block calculation in one atomic `INSERT … ON CONFLICT DO UPDATE`; key format is `` `${throttlerName}:${key}` ``.
- Depends on `app.set('trust proxy', 1)` in `bootstrap.ts` — without it every user shares one bucket.
- Per-endpoint overrides today: login 5/60s.

## JWT user cache

`JwtStrategy` holds an in-process `Map<userId, { payload, expiresAt }>` with a **60 s TTL**. On a miss it re-reads the user from the DB, and throws `UnauthorizedException('User no longer exists')` (plus deletes the entry) if the user is gone.

**Caveat:** there is **no active invalidation** — nothing else clears this cache. Role/market/profile changes take up to 60 s to take effect, and the cache is per-instance, so serverless instances diverge.

## Auth flow

**Auth is Bearer-token, not cookie-based.**

`JwtStrategy` extracts the token *only* from `Authorization: Bearer <token>` (`ExtractJwt.fromAuthHeaderAsBearerToken()`, `src/auth/strategies/jwt.strategy.ts`). There is no cookie extraction anywhere in `src/`.

Endpoints:

- `POST /api/auth/login` — `@Public()`, throttled 5/60s, `@HttpCode(200)`. Body: `{ email, password }`. Response: `{ accessToken, user }` (`AuthResponseDto`) — both fields are returned in the JSON body; the client stores `accessToken` itself (`localStorage`) and sends it back as `Authorization: Bearer <accessToken>`.
- **There is no `/api/auth/logout` endpoint, no refresh token, no token rotation, and no `RefreshToken` Prisma model.** The access token is a single JWT (`JWT_ACCESS_EXPIRES_IN`, default `15m`) with no server-side revocation — logging out is purely a frontend action (clear `localStorage`).

Token internals (`auth.service.ts` / `src/interfaces/jwt-payload.interface.ts`):

- `JwtPayload` has 7 fields: `sub`, `email`, `role`, `id`, `name`, `image?`, `marketId?`.
- `AuthService.login()` verifies the password with bcrypt `compare`, then signs one JWT via `jwtService.signAsync(payload)`.

## Products domain rules

- `GET /products` and `GET /products/:id` are accessible to `ADMIN`, `OWNER`, and `SELLER` (sellers need product catalog access to create transactions), while write operations (`POST /`, `PATCH /:id`, `POST /:id/restock`, `DELETE /:id`) require `ADMIN` or `OWNER`.
- **Stock changes only through the journal.** `Product.quantity` is the fast "current number", but it is moved only by `moveStock()` + `logMovement(s)` (`src/products/stock.util.ts`) inside one DB transaction, so for every product `Σ StockMovement.delta = quantity` (verified by the seed). Movement types: `OPENING` (product created / journal backfill), `SALE`, `REFUND`, `VOID` (receipt deleted — opposite sign), `RESTOCK`, `WRITE_OFF` (needs a reason: `DAMAGED | EXPIRED | LOST | OWN_USE | OTHER`), `ADJUSTMENT` (inventory count). Rows are never edited; deleting a receipt sets `transactionId` to NULL but keeps the row. Never `product.update({ quantity })` directly.
- `PATCH /products/:id` does **not** accept `quantity` (400 via `forbidNonWhitelisted`) — it would overwrite sales made meanwhile. Use the actions below.
- `POST /products/:id/restock` (`{ quantity, note? }`) adds to stock atomically (`increment` guarded by `quantity <= MAX_STOCK - quantity`).
- `POST /products/:id/write-off` (`{ quantity, reason, note? }`) removes stock atomically, never below zero (400 `PRODUCT_NOT_ENOUGH_STOCK` with `details.available`).
- `POST /products/:id/adjust` (`{ quantity, note? }`) inventory count: sets the counted TOTAL and journals the difference; 409 `PRODUCT_STOCK_CHANGED` (`details.currentQuantity`) if stock changed while counting.
- `GET /products/:id/movements` (ADMIN/OWNER) — paginated journal, newest first, filter `type`, `dateFrom/dateTo`.
- `POST /products/:id/archive` / `unarchive` — archive replaces deletion for products with history: archived products are hidden from `GET /products` (use `?archived=true` to list them), cannot be sold (400 "archived"), and are excluded from dashboard stock health. `DELETE` of a product with receipts answers 409 `PRODUCT_HAS_TRANSACTIONS` with `details.canArchive: true`; a product without history is deleted together with its journal.
- `GET /products/summary` (ADMIN/OWNER) — active/archived counts, out-of-stock, low-stock, stock value at retail and at cost, potential profit, `productsWithoutCost`. Static routes (`summary`, `bulk-price`) are declared **before** `:id`.
- `POST /products/bulk-price` (ADMIN/OWNER, needs a market) — `{ percent, categoryId?, roundTo?, dryRun? }`: one `UPDATE` changing prices of active products by ±N% rounded to a step (min price = one step). `dryRun: true` previews up to 20 rows and writes nothing. Past receipts keep their own price snapshot; `costPrice` is untouched. There is no price history table yet.
- `GET /products` metrics window: `?days=N` (rolling, 1–365) overrides `?period=` (calendar). Boolean query flags (`lowStock`, `needsReorder`, `archived`) go through `toBoolean` — `@Type(() => Boolean)` would turn `"false"` into `true`.

## Transactions domain rules

- `POST /transactions` — any role, **but a SELLER may only create `DEBT`** → `ForbiddenException('Sellers can only create DEBT transactions')`. Otherwise a seller could drain stock with no debt obligation.
- `DEBT` requires `debtorId` (else `BadRequestException`), and the debtor must belong to the caller's market. `SALE` ignores `debtorId` and optionally persists `customerName`.
- **Prices are always recomputed from the DB**, never trusted from the client. Line items support `discount` and `markup` (`validateAndComputeItems`); negative line totals are rejected.
- **Stock decrement is atomic**: `updateMany({ where: { id, quantity: { gte: item.quantity } }, data: { quantity: { decrement } } })`; `count === 0` → `Not enough stock`.
- Status on create: `DEBT` → `ACTIVE` with `remainingAmount = total`; otherwise `PAID` with `remainingAmount = 0`.
- `PATCH /transactions/:id` — ADMIN/OWNER. **Finalized (`PAID`/`REFUNDED`) transactions cannot be edited.**
- `DELETE /transactions/:id` — ADMIN/OWNER. Restores stock, using `direction = -1` for REFUND rows so deleting a refund doesn't inflate stock.
- `PATCH /transactions/:id/pay` — **any role**, `@Idempotent()`. Rejects overpayment and already-paid rows; optimistic-concurrency guarded on exact `remainingAmount`; resolves to `PAID` or `PARTIAL` and writes a `Payment` row.
- `POST /transactions/:id/refund` — **ADMIN/OWNER only**, `@Idempotent()`. Supports full or partial refund (`RefundTransactionDto.items`) on a `PAID` or `PARTIALLY_REFUNDED` `SALE`. Atomically increments `refundedQuantity` on each `TransactionItem`, restores product stock, creates a linked `REFUND` transaction, and sets the original transaction status to `PARTIALLY_REFUNDED` or `REFUNDED`.

## Dashboard

- `GET /dashboard?period=today|week|month|year&dateFrom&dateTo&sellerId`. `period` **overrides** `dateFrom`/`dateTo`; with none supplied it defaults to the **current month** (`resolvePeriod` in `src/common/utils/period.util.ts`) to avoid a full-history scan. All boundaries are computed in **UTC** deliberately.
- Returns `stats` (with period-over-period comparison), `recentTransactions` (5), `topDebtors` (10), `revenueTrend`, `paymentDistribution`, `inventoryHealth`, `debtorAging`, `topProducts`, `pulse`, `cashflow`, `profitSummary`, `weekdayChart`, `hourlyHeatmap`, and `sellerLeaderboard`.
- Revenue/payment metrics count **only `type = 'SALE'` and `status <> 'REFUNDED'`**.
- Raw SQL queries in `DashboardMetricsService`, `DashboardInsightsService`, and `DashboardAnalyticsService` use `$queryRaw` with `Prisma.sql` fragments joined via `Prisma.join(conditions, ' AND ')`. **Follow this parameterized `Prisma.sql` pattern for any new raw query.**
- `GET /dashboard/sellers-report` — handled by `DashboardSellersService`: per-seller `{ seller, salesCount, salesAmount, refundsCount, refundsAmount, debtsCount, debtsAmount, ... }`. Key rule: a REFUND is charged back to the seller who made the **original SALE** (`refundOf.createdById`), not whoever processed the refund. `salesAmount = sales − refunds`.

## Users — last-admin protection

`ensureNotLastAdmin()` counts users with `role: ADMIN` and throws `ConflictException('Cannot remove or demote the last admin account')` when `<= 1`. Called on **demotion** and on **delete**.

## Seed

- Run `npm run prisma:seed` against an empty/migrated DB. It **wipes all tables** first (incl. `IdempotencyKey`, `ThrottleBucket`).
- Deterministic (no `Math.random`), relative to "now": 2 markets × (owner + sellers, 5 categories, 25 products, 7 debtors, 45 sales, 18 debts, 9 refunds). Re-seed right before testing the 10-minute seller-cancel rule — the "fresh" debt is created 3 minutes before the seed ran.
- The seed also writes the stock journal (≈195 movements per market: opening balances, sales, refunds, restocks, write-offs, one cancelled receipt as `SALE`+`VOID`, an inventory `ADJUSTMENT`) and archives one product per market; it throws if `Σ delta ≠ quantity` for any product.
- Coverage is intentional, so no screen/query is empty: debtor scenarios (reliable / overdue + over credit limit / due soon / advance / settled / no due date / new), debts with advance, partial and full payments, notes, refund reasons, partial + repeated refunds, markup + seller payouts, low/zero/dead stock, products without `costPrice`, sales today/yesterday/last year (for period comparisons), varied hours (heatmap).
- Logins (password `12345678Aa` for all): `admin@tradecrm.com` (ADMIN); `alisher@tradecrm.com`, `dilnoza@tradecrm.com` (OWNER); sellers `sultonzoda2011@gmail.com`, `bakhtiyar@`, `madina@` (market 1, @tradecrm.com except the first) and `jasur@`, `nigora@` (market 2).
- No images are uploaded (all `image` fields are null).

## .env required vars

```
DATABASE_URL, JWT_ACCESS_SECRET, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
```

Optional (validated in `src/config/env.validation.ts` with defaults): `NODE_ENV` (`development`), `JWT_ACCESS_EXPIRES_IN` (`15m`), `BCRYPT_ROUNDS` (`12`), `PORT` (`3000`).

Not validated — read via raw `process.env`: `DATABASE_POOL_MAX` (default `10`; на Vercel выставить `2`–`3` — каждый serverless-инстанс держит свой pg-пул).

**Port trap:** `.env.example` ships `PORT=4000` because `frontend/.env` points `VITE_API_URL` at `:4000`, but the code default is `3000` (`main.ts`). Run the backend without `PORT` set and the frontend talks to nothing. The Swagger server URL derives from `PORT` rather than hardcoding a port.
