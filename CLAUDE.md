# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TradeCRM — RESTful CRM API for markets/bazaars. NestJS v11 (Express) + Prisma v7 (with the `@prisma/adapter-pg` driver adapter) + PostgreSQL. JWT auth with refresh-token rotation, RBAC, image uploads to the local filesystem.

## Commands

```bash
npm run start:dev        # dev server (hot reload), runs on PORT from .env (4000)
npm run build            # nest build → dist/  (entry: dist/src/main)
npm start               # node dist/src/main (production build)

npx prisma generate      # regenerate the Prisma client — REQUIRED after any schema.prisma change
npm run prisma:migrate   # prisma migrate dev
npm run prisma:studio    # Prisma Studio
npm run prisma:seed      # ts-node prisma/seed.ts — creates admin@tradecrm.com / 12345678Aa
```

There is **no test runner and no linter** configured (no `test`/`lint` scripts, no Jest/ESLint). Don't assume CI checks or `npm test`; verify by building and exercising endpoints via Swagger.

### Critical onboarding gotcha

The Prisma client is generated into `prisma/generated/`, and that directory is **gitignored** (along with `src/generated/` and `prisma/migrations/`). A fresh checkout has no generated client, so `npm run build` will fail with type errors on Prisma model fields until you run `npx prisma generate`. Source imports the client as `prisma/generated/client`. The README's "После обновления схемы" warning reinforces this — always regenerate after touching `schema.prisma`.

## Two entry points

- `src/main.ts` — local/standard Nest bootstrap. Sets global `/api` prefix, CORS, `ValidationPipe`, static `/uploads` serving, and Swagger at `/api/docs` (non-production only).
- `api/index.ts` — Vercel serverless handler. Bootstraps a **cached** `AppModule` (via `ExpressAdapter`) and delegates `req/res` to it. `vercel.json` runs `npx prisma generate && npm run build` and rewrites `/(.*)` → `/api`. This handler does **not** configure Swagger or static `/uploads` serving, and Vercel's filesystem is ephemeral — uploaded images won't persist there. Keep the two bootstraps in sync when changing global middleware in `main.ts`.

## Architecture

### Global cross-cutting (wired in modules marked `@Global()`)

`PrismaModule`, `CommonModule`, and `AuthModule` are `@Global()`, so their providers are injected everywhere without imports.

Three `APP_GUARD`s run in order (order matters):
1. **`ThrottlerGuard`** (`app.module.ts`) — 100 req/min/IP globally; `/auth/login` overrides with `@Throttle({ default: { limit: 5, ttl: 60_000 } })`.
2. **`JwtAuthGuard`** (`auth.module.ts`) — every route requires a valid Bearer JWT by default. Bypass with `@Public()`. `JwtStrategy.validate` loads the user from the DB on each request, so `request.user` is a fresh `JwtPayload` (`{ sub, email, name, role, marketId }`) — not a stale copy of the token claims.
3. **`RolesGuard`** (`auth.module.ts`) — enforces `@Roles(...Role[])`. No `@Roles` decorator ⇒ any authenticated user allowed. Runs after JWT so `request.user` is populated.

### Request/response envelope

- **Success**: `TransformInterceptor` (`common/interceptors/`) wraps all responses as `{ success: true, data, timestamp }`. Controllers simply return payload objects.
- **Error**: `AllExceptionsFilter` (`common/filters/`) returns `{ success: false, statusCode, message: string[], error?, timestamp }` and normalizes nested validation messages. It maps Prisma error codes to friendly 4xx (`P2002`→409, `P2003`→409 "has related data", `P2025`→404) so consumers don't need to know Prisma. In production, unexpected errors are logged in full but the client gets a generic `Internal server error` (stack/DB details hidden).

Global `ValidationPipe` uses `whitelist: true, forbidNonWhitelisted: true, transform: true, enableImplicitConversion: true` — DTOs must declare every field, and query/path params get type-coerced. DTOs lean on `class-validator` + `class-transformer` `@Type`.

### Market scoping (the central data-access pattern)

Most data is private to a `Market`. Controllers read `@CurrentUser('marketId')` and pass it into the service as an optional `marketId`:
- List/get/update/delete add `where.marketId = marketId` only when set — if `marketId` is undefined (e.g. an `ADMIN` with no assigned market), the query is **unscoped** and returns everything. This is intentional: admins see all, owners/sellers see only their market.
- Mutations that create market-owned records (`SellersService.create`, `TransactionsService.create`, etc.) **throw `UnauthorizedException('User is not assigned to a market')`** when `marketId` is absent — they don't silently create unscoped records.

### Pagination & filtering

`BaseQueryDto` (`common/dto/`) defines the shared query contract: `page` (default 1), `limit` (max 100, default 20), `search`, `dateFrom`/`dateTo` (ISO, filter `createdAt`), `sortBy`, `sortOrder` (`asc|desc`, default `desc`). Module-specific `dto/query-*.dto.ts` files extend it with entity-specific filters (e.g. `role`, `categoryId`, `lowStock`, `debtorId`, `type`, `status`).

Services use the helpers in `common/utils/paginate.util.ts`:
- `paginate({page,limit}, fetchPage, fetchTotal)` — runs `findMany` + `count` in parallel and returns `{ data, meta: { page, limit, total, totalPages } }`.
- `buildOrderBy(sortBy, sortOrder)` and `buildDateWhere(dateFrom, dateTo)` — keep `where`/`orderBy` construction consistent. Reuse these instead of inlining.

### Image uploads

Uploads use `multipart/form-data` with a single `image` field, intercepted by `FileInterceptor('image', multerOptions)` where `multerOptions` uses `memoryStorage` (file arrives as a buffer).

`common/utils/multipart.util.ts` holds the **single source of truth** for allowed types via `ALLOWED_IMAGE_MIME_TYPES` (jpg/png/webp/gif, 5MB cap). `StorageService.save`:
- Verifies **magic bytes** against the declared mimetype (mimetype in the header is client-controlled and spoofable) — rejects anything whose content doesn't match.
- Derives the file **extension from the validated mimetype**, never from the client-supplied filename — so a file can't be saved with an arbitrary/executable extension under the guise of an image.
- Writes to `uploads/<subfolder>/<uuid><ext>` and returns `/uploads/<subfolder>/<uuid><ext>`, which `main.ts` serves statically.

Convention: on update with a new image, delete the old one (`storageService.delete(entity.image)`); on entity deletion, delete its image. See `SellersService` for the canonical pattern.

### Concurrency in `TransactionsService`

Sales and debt payments intentionally use optimistic, atomic conditional updates inside `prisma.$transaction` rather than read-then-write:
- Stock decrement: `tx.product.updateMany({ where: { id, quantity: { gte: qty } }, data: { quantity: { decrement: qty } } })` — `result.count === 0` means insufficient stock.
- Debt payment: re-checks `remainingAmount: { gte: amount }` inside the transaction and uses `updateMany` with `where: { id, remainingAmount: current }` (compare-and-set) so two simultaneous payments on one debt can't double-spend; a 0 count throws a "modified concurrently, please retry" error.

Prices and line totals are computed from the DB's current `product.price`, never from client-submitted values. Refunds restore stock and create a linked `REFUND` transaction. When adding transactional business logic, follow this compare-and-set + `count === 0` check pattern and keep the explanatory comments — they document non-obvious race-prevention intent.

### Refresh tokens

Refresh tokens are stored in the DB as a **SHA-256 hash**; the client receives the raw token. On `refresh`, a reused (already-revoked) token triggers revocation of **all** that user's refresh tokens (token-theft detection), not just the offending one. `parseDuration` converts `JWT_REFRESH_EXPIRES_IN` strings (`7d`, `15m`) to ms.

## Conventions for new feature modules

- Structure as `src/<feature>/`: `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, and `dto/` (`create-*`, `update-*`, `query-*` extends `BaseQueryDto`, `*-response` for Swagger).
- Inject `PrismaService` and (if uploads) `StorageService` — both globally available.
- Default-secure: routes are JWT-protected automatically; add `@Public()` only for genuinely public endpoints, `@Roles(...)` to restrict by role. Decorate with `@ApiTags`, `@ApiOperation`, `@ApiOkResponse({ type: ResponseDto })`, `@ApiErrorResponse()` for Swagger.
- Use `@Param('id', ParseUUIDPipe)` for UUID path params.
- Apply market scoping via `@CurrentUser('marketId')` passed into the service — see `SellersService` as the template.
- Model enums live in `src/enums/` and mirror the Prisma enums in `schema.prisma`; shared types in `src/interfaces/`.

## Environment

Validated by `src/config/env.validation.ts` (loaded via `ConfigModule.forRoot({ validate })`). Required: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Defaults: `JWT_ACCESS_EXPIRES_IN=15m`, `JWT_REFRESH_EXPIRES_IN=7d`, `PORT=3000` (overridden to `4000` in the committed `.env`). Note `datasource db` in `schema.prisma` has no `url` — the connection string is supplied to the `PrismaPg` adapter at runtime from `process.env.DATABASE_URL`.
