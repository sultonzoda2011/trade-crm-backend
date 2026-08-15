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
- `jest.config.js`: `rootDir: 'src'`, `testRegex: '.*\.spec\.ts$'`, `clearMocks: true`, coverage output `../coverage`.
- Specs live next to sources as `*.spec.ts`; `tsconfig.build.json` excludes them from the build.
- 8 spec files cover: `auth.service` (login/refresh rotation/logout), `jwt.strategy` (caching), `transactions.service` (role/debtor/refund rules), `dashboard.service` (stats + revenue trend + payment distribution, mocked Prisma + `$queryRaw` assertions), `health.controller` (DB up/down), `markets.service` (**IDOR scoping**), `users.service` (last-admin protection), `throttler-storage.service` (rate-limit storage).

## CI

`.github/workflows/ci.yml` — job `typecheck-test`, on push to `main` and all PRs. Node 22, Postgres 16 service container. Steps in order:

`npm ci` → `npx prisma generate` → `npx tsc --noEmit -p tsconfig.build.json` → `npm test` → `npx prisma migrate deploy` → `npm audit --omit=dev --audit-level=high`

## TypeScript strictness

`strict`, `strictNullChecks`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames` are ON. `strictPropertyInitialization` is **off** (DTO/entity classes rely on it). Target `ES2023`, module `commonjs`. Not enabled: `noUnusedLocals`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`.

## Prisma v7 + Postgres adapter

- Prisma client is generated to `node_modules/@prisma/client` (default output of `prisma generate` in v7).
- Import `Prisma` namespace / client types from `@prisma/client` (not `prisma/generated/` — that folder is legacy and stale).
- `PrismaService` uses `@prisma/adapter-pg` — the adapter is constructed with the raw `DATABASE_URL` env var, not via PrismaClient's `datasources`.
- DB config: `prisma.config.ts` (Prisma v7 config file format, not `prisma/schema.prisma` for datasource URLs).
- Migrations: `prisma/migrations/`.
- Run `prisma generate` after any schema change (`npm run prisma:generate`), otherwise `npx tsc` will fail against stale types.
- Models: `User, RefreshToken, Market, Category, Product, Debtor, Transaction, TransactionItem, Payment, ThrottleBucket`.
- `Transaction` has a self-relation for refunds: `refundOfId String? @unique` (relation `"TransactionRefund"`), plus composite indexes `@@index([marketId, type, createdAt])` and `@@index([createdById, type, createdAt])`.
- `PrismaService.onModuleInit()` sweeps stale `ThrottleBucket` rows, wrapped in try/catch so a missing migration doesn't crash boot.
- Enums are duplicated (Prisma schema + `src/enums/`) and are currently **in sync**: `Role`, `TransactionType`, `PaymentType`, `TransactionStatus`, `ProductUnit`. `DashboardPeriod` is DTO-only (`dashboard/dto/query-dashboard.dto.ts`, lowercase values) — intentionally not in Prisma.

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
- **File uploads**: `StorageService` uploads to **Cloudinary** (`cloudinary` v2, configured from `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`). Multer `memoryStorage`, validated via `imageFileFilter` (jpg/png/webp/gif, max 5MB). No local `uploads/` folder — do not reintroduce `express.static` for it.

### Registered modules

`app.module.ts` registers, in order: `PrismaModule, AuthModule, CommonModule, UsersModule, MarketsModule, CategoriesModule, ProductsModule, ProfileModule, SellersModule, DebtorsModule, TransactionsModule, DashboardModule, HealthModule`.

### Endpoint map

All paths below are under the `/api` prefix.

| Module | Prefix | Class-level `@Roles` | Endpoints |
|---|---|---|---|
| categories | `categories` | ADMIN, OWNER | `POST /` (multipart), `GET /`, `GET /:id`, `PATCH /:id` (multipart), `DELETE /:id` |
| products | `products` | ADMIN, OWNER | `POST /` (multipart), `GET /` (+`lowStock`, `priceMin/Max`, `categoryId`), `GET /:id`, `PATCH /:id` (multipart), `DELETE /:id` |
| markets | `markets` | ADMIN, OWNER | `POST /` **ADMIN only**, `GET /`, `GET /:id`, `PATCH /:id` ADMIN+OWNER, `DELETE /:id` **ADMIN only** |
| sellers | `sellers` | OWNER, ADMIN | `POST /` (multipart), `GET /`, `GET /:id`, `PATCH /:id` (multipart), `DELETE /:id` |
| debtors | `debtors` | none (SELLER allowed) | `POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` **ADMIN+OWNER** |
| profile | `profile` | none (any authed user) | `GET /`, `PATCH /` (multipart), `PATCH /password` |
| users | `users` | none at class level; **every** method is `@Roles(Role.ADMIN)` | `POST /` (multipart), `GET /`, `GET /:id`, `PATCH /:id` (multipart), `DELETE /:id` |
| transactions | `transactions` | none (SELLER allowed, restricted in service) | see Transactions domain rules |
| dashboard | `dashboard` | ADMIN, OWNER | `GET /`, `GET /sellers-report` |
| health | `health` | `@Public()` | `GET /` → `{status, database, timestamp}`; `SELECT 1` probe, 503 on failure |

## Market scoping / IDOR rule (MUST follow)

> Every read/write of a market-owned entity passes the caller's `marketId` down to the service, and a cross-market hit throws **`NotFoundException`, never `ForbiddenException`** — so record existence is not leaked.

- Controllers compute scope as `user.role === Role.OWNER ? user.marketId : undefined` (ADMIN is unscoped).
- Enforced in `markets.service.ts`, `products.service.ts` (`getProductOrThrow`), `transactions.service.ts`.
- Enforce it inside raw SQL too — e.g. `products.service.ts` pushes `p."marketId" = ${userMarketId}` into the `lowStock` `$queryRaw`.
- Regression tests: `markets.service.spec.ts` → `describe('MarketsService (IDOR scoping)')`.

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
- Per-endpoint overrides today: login 5/60s, refresh 10/60s.

## JWT user cache

`JwtStrategy` holds an in-process `Map<userId, { payload, expiresAt }>` with a **60 s TTL**. On a miss it re-reads the user from the DB, and throws `UnauthorizedException('User no longer exists')` (plus deletes the entry) if the user is gone.

**Caveat:** there is **no active invalidation** — nothing else clears this cache. Role/market/profile changes take up to 60 s to take effect, and the cache is per-instance, so serverless instances diverge.

## Auth flow

**Auth is cookie-based, not Bearer.** `JwtStrategy` extracts the token *only* from the `accessToken` cookie via a custom `cookieExtractor` — an `Authorization: Bearer` header will **not** authenticate. The `@ApiBearerAuth()` decorators scattered around are decorative leftovers.

`AuthController` sets three cookies (all `secure` in production, `sameSite: production ? 'none' : 'lax'`, `path: '/'`):

| Cookie | httpOnly | maxAge | Purpose |
|---|---|---|---|
| `accessToken` | **yes** | 15 min | JWT — the only accepted credential |
| `refreshToken` | **yes** | 30 days | rotation token |
| `user` | **no** | 30 days | `encodeURIComponent(JSON.stringify(AuthUserDto))` — read by the frontend for client-side RBAC |

Endpoints:

- `POST /api/auth/login` — `@Public()`, throttled 5/60s, `@HttpCode(200)`. Sets all 3 cookies. Body returns `{ accessToken, user }` — **`refreshToken` is never in the response body**, the controller intercepts it into the cookie.
- `POST /api/auth/refresh` — `@Public()`, throttled 10/60s, `@HttpCode(200)`. Reads the `refreshToken` **cookie** (throws `UnauthorizedException('Refresh token missing')` if absent), re-sets all 3 cookies, returns `{ accessToken, user }`.
- `POST /api/auth/logout` — **authenticated** (not `@Public()`), `@HttpCode(204)`. Clears all 3 cookies.

Token internals (`auth.service.ts`):

- `JwtPayload` has 7 fields: `sub`, `email`, `role`, `id`, `name`, `image?`, `marketId?`.
- Refresh tokens are UUIDs stored as **SHA-256 hashes** in the DB, never in plaintext.
- Rotation is **atomic** — `updateMany` guarded by `revokedAt: null`.
- **Reuse detection**: presenting an already-revoked token revokes *all* of that user's tokens and logs a warning. A lost concurrent-rotation race (`count === 0`) is treated the same way.
- `parseDuration` regex is `^(\d+)([smhd])$`, falling back to **7d** on unparseable input.
- Login and refresh both fire-and-forget `cleanupExpiredTokens`, which prunes expired `refreshToken` rows *and* expired `ThrottleBucket` rows.

## Transactions domain rules

- `POST /transactions` — any role, **but a SELLER may only create `DEBT`** → `ForbiddenException('Sellers can only create DEBT transactions')`. Otherwise a seller could drain stock with no debt obligation.
- `DEBT` requires `debtorId` (else `BadRequestException`), and the debtor must belong to the caller's market.
- **Prices are always recomputed from the DB**, never trusted from the client. Negative line totals after discount are rejected.
- **Stock decrement is atomic**: `updateMany({ where: { id, quantity: { gte: item.quantity } }, data: { quantity: { decrement } } })`; `count === 0` → `Not enough stock`.
- Status on create: `DEBT` → `ACTIVE` with `remainingAmount = total`; otherwise `PAID` with `remainingAmount = 0`.
- `PATCH /transactions/:id` — ADMIN/OWNER. **Finalized (`PAID`/`REFUNDED`) transactions cannot be edited.**
- `DELETE /transactions/:id` — ADMIN/OWNER. Restores stock, using `direction = -1` for REFUND rows so deleting a refund doesn't inflate stock.
- `PATCH /transactions/:id/pay` — **any role**. Rejects overpayment and already-paid rows; the update is optimistic-concurrency guarded on the exact `remainingAmount`; resolves to `PAID` or `PARTIAL` and writes a `Payment` row.
- `POST /transactions/:id/refund` — **ADMIN/OWNER only**. Only a `SALE` with status `PAID` and no existing refund. Creates a `REFUND` transaction linked via `refundOfId`, restores stock, marks the original `REFUNDED`.

## Dashboard

- `GET /dashboard?period=today|week|month|year&dateFrom&dateTo&sellerId`. `period` **overrides** `dateFrom`/`dateTo`; with none supplied it defaults to the **current month** to avoid a full-history scan. All boundaries are computed in **UTC** deliberately.
- Returns `stats { totalMarkets, totalUsers, totalDebtors, totalTransactions, activeDebts, partialDebts, totalDebtAmount, totalSaleAmount, todayTransactions }`, plus `recentTransactions` (5), `topDebtors` (10), `revenueTrend`, `paymentDistribution`.
- Revenue/payment metrics count **only `type = 'SALE'` and `status <> 'REFUNDED'`**.
- `getRevenueTrend` uses `$queryRaw` with `Prisma.sql` fragments joined via `Prisma.join(conditions, ' AND ')` and `date_trunc(${truncUnit}, "createdAt")`, where `truncUnit` is `'month'` for `period=year` else `'day'`. **Follow this parameterized `Prisma.sql` pattern for any new raw query.**
- `GET /dashboard/sellers-report` — per-seller `{ seller, salesCount, salesAmount, refundsCount, refundsAmount, debtsCount, debtsAmount }`. Key rule: a REFUND is charged back to the seller who made the **original SALE** (`refundOf.createdById`), not whoever processed the refund. `salesAmount = sales − refunds`.

## Users — last-admin protection

`ensureNotLastAdmin()` counts users with `role: ADMIN` and throws `ConflictException('Cannot remove or demote the last admin account')` when `<= 1`. Called on **demotion** and on **delete**.

## Seed

- Run `npm run prisma:seed` after migrate.
- Admin: `admin@tradecrm.com` / `12345678Aa`
- Clears all tables before seeding (delete order respects FK constraints).
- Creates 2 markets, each with owner + 2 sellers, random products/debtors/transactions.
- Uploads images from `prisma/png/` to Cloudinary with an in-memory cache. bcrypt rounds are hardcoded to `10` here.
- Named seed users: `alisher@`, `bakhtiyar@`, `madina@` (market 1); `dilnoza@`, `jasur@`, `nigora@` (market 2). All use password `12345678Aa`.

## .env required vars

```
DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
```

Optional (validated in `src/config/env.validation.ts` with defaults): `NODE_ENV` (`development`), `JWT_ACCESS_EXPIRES_IN` (`15m`), `JWT_REFRESH_EXPIRES_IN` (`7d`), `BCRYPT_ROUNDS` (`12`), `PORT` (`3000`).

Not validated — read via raw `process.env`: `DATABASE_POOL_MAX` (default `10`; на Vercel выставить `2`–`3` — каждый serverless-инстанс держит свой pg-пул).

**Port trap:** `.env.example` ships `PORT=4000` because `frontend/.env` points `VITE_API_URL` at `:4000`, but the code default is `3000` (`main.ts`). Run the backend without `PORT` set and the frontend talks to nothing. The Swagger server URL derives from `PORT` rather than hardcoding a port.
