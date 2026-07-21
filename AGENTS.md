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

No tests exist (`jest` not even installed). There is no lint or typecheck script.

## Prisma v7 + Postgres adapter

- Prisma client is generated to `prisma/generated/client` (not `node_modules/.prisma`).
- Import from `prisma/generated/client` (not `@prisma/client`).
- `PrismaService` uses `@prisma/adapter-pg` — the adapter is constructed with the raw `DATABASE_URL` env var, not via PrismaClient's `datasources`.
- DB config: `prisma.config.ts` (Prisma v7 config file format, not `prisma/schema.prisma` for datasource URLs).
- Migrations: `prisma/migrations/`.

## Architecture

- **NestJS v11** (Express platform). Entry: `src/main.ts`, root module: `src/app.module.ts`
- All API routes prefixed with `/api`. Swagger at `/api/docs` (dev only).
- **Global auth** — `JwtAuthGuard` + `RolesGuard` registered app-wide in `AuthModule`.
  - Bypass with `@Public()` decorator.
  - Require roles with `@Roles(Role.ADMIN)` etc.
  - Access user via `@CurrentUser()` param decorator (returns `JwtPayload` or a key thereof).
- **Global response format** (via `TransformInterceptor`): `{ success: true, data, timestamp }`
- **Global exception filter** catches all unhandled errors.
- **ValidationPipe** globally (whitelist, forbid non-whitelisted, auto-transform).
- **Enums** are duplicated: Prisma schema enums + TypeScript enums in `src/enums/` — keep in sync.
- **File uploads**: `StorageService` saves to `uploads/` on local filesystem, served at `/uploads`. Multer `memoryStorage`, validated via `imageFileFilter` (jpg/png/webp/gif, max 5MB).

## Auth flow

- Login → `{ accessToken, refreshToken, user }`
- Access token: signed JWT with `JwtPayload` (`sub`, `email`, `role`, `marketId`)
- Refresh token: UUID stored in DB with expiry and optional `revokedAt` (rotation: old token is revoked on refresh)
- Refresh token expiry parsed from `JWT_REFRESH_EXPIRES_IN` (e.g. `30d`) via hardcoded `parseDuration` helper in `auth.service.ts`

## Seed

- Run `npm run prisma:seed` after migrate.
- Admin: `admin@tradecrm.com` / `12345678Aa`
- Clears all tables before seeding (delete order respects FK constraints).
- Creates 2 markets, each with owner + 2 sellers, random products/debtors/transactions.

## .env required vars

```
DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
```
Optional: `JWT_ACCESS_EXPIRES_IN` (default `15m`), `JWT_REFRESH_EXPIRES_IN` (default `7d`), `PORT` (default `3000`), `NODE_ENV` (default `development`).
