# TradeCRM Backend

**v0.1.0** — RESTful CRM API for managing markets and bazaars. Built with NestJS, Prisma, and PostgreSQL.

## Quick Start

```bash
npm install                        # postinstall runs `prisma generate` automatically
cp .env.example .env               # fill in DATABASE_URL, JWT_ACCESS_SECRET, Cloudinary keys
npx prisma migrate dev             # apply schema / create migrations
npm run prisma:seed                # optional: test data
npm run start:dev                  # http://localhost:4000/api
```

Swagger docs: `http://localhost:4000/api/docs`

Default seed credentials: `admin@tradecrm.com` / `12345678Aa`

> **Note on Prisma v7:** `prisma generate` writes the client to `node_modules/@prisma/client` —
> this is the only current source of types. Do not import from `prisma/generated/`
> (stale artifact of an old config; it is no longer updated).

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22+ |
| Language | TypeScript 5.9 (strict) |
| Framework | NestJS v11 (Express 5) |
| Database | PostgreSQL (pg driver pool, `DATABASE_POOL_MAX`) |
| ORM | Prisma v7 (`@prisma/adapter-pg`) |
| Auth | JWT Bearer access token (bcrypt, passport-jwt) |
| Validation | class-validator + class-transformer |
| Security | helmet, `@nestjs/throttler` (Postgres-backed), `Idempotency-Key` deduplication |
| API Docs | Swagger / OpenAPI |
| File Storage | Cloudinary (`@UploadImage()` composite decorator) |
| Tests | jest + ts-jest (12 spec suites, mocked Prisma, no DB) |
| CI | GitHub Actions (`typecheck` → `test` → `migrate deploy` → `npm audit`) |
| Deploy | Vercel (serverless, `api/index.ts`) |

## Features

- **JWT Bearer authentication** (`POST /api/auth/login` returns `{ accessToken, user }`) with 60s in-memory user verification cache in `JwtStrategy`
- **Role-based access control**: `ADMIN`, `OWNER`, `SELLER`; global `JwtAuthGuard` + `RolesGuard` with `@Public()` bypass
- **CRUD & combined detail endpoints (`/:id/full`)** for users, markets, products, sellers, debtors, and transactions
- **Atomic stock operations**:
  - Atomic stock decrement on transaction creation
  - Atomic stock addition via `POST /api/products/:id/restock` (`RestockProductDto`)
- **Transactions, payments & refunds**:
  - Line-item `discount` and `markup` with DB-verified pricing
  - Partial and full debt payments (`PATCH /api/transactions/:id/pay`) with optimistic concurrency protection
  - Full and partial item-level sale refunds (`POST /api/transactions/:id/refund` → `PARTIALLY_REFUNDED` / `REFUNDED`)
- **Business analytics (`AnalyticsModule`)**:
  - Products: sales velocity, days of stock, return rate, stock health (`healthy | low | critical | out | overstocked`), reorder priority
  - Debtors: overdue days, payment discipline, risk level (`LOW | MEDIUM | HIGH | CRITICAL`), credit profile
  - Sellers & Markets: period KPIs, rankings, period-over-period comparisons
- **Dashboard (`DashboardModule`)**:
  - Modularized into `DashboardService`, `DashboardMetricsService`, `DashboardInsightsService`, `DashboardAnalyticsService`, and `DashboardSellersService`
  - KPI stats, revenue trend (`day`/`month` UTC buckets), payment distribution, inventory health, debtor aging buckets, top products, pulse/cashflow/profit summary, weekday & hourly heatmaps, and seller leaderboard / attribution report
- **Idempotency (`@Idempotent()`)**:
  - `IdempotencyInterceptor` deduplicates offline-capable mutations (`POST /debtors`, `POST /transactions`, `PATCH /transactions/:id/pay`, `POST /transactions/:id/refund`) via `IdempotencyRecord` (24h TTL)
- **Rate limiting**: Postgres-backed `PrismaThrottlerStorage` (`ThrottleBucket`, 100 req/min global, 5 req/min on login)
- **Image uploads**: Cloudinary upload via `@UploadImage()` decorator (JPEG, PNG, WebP, GIF; max 5MB)
- **Market scoping (IDOR protection)**: cross-market access throws `NotFoundException` to avoid leaking record existence

## Architecture

```text
src/
├── main.ts                  # Local entry point (bootstrap() + listen)
├── bootstrap.ts             # configureApp(): shared app configuration
├── app.module.ts            # Root module
├── analytics/               # Product/debtor/seller/market business metrics & health scoring
├── auth/                    # Auth module (JWT, guards, strategies, decorators)
├── common/                  # Shared filters, interceptors (idempotency, transform, logging), pipes, decorators (@UploadImage, @Idempotent), utils (paginate, period)
├── config/                  # Environment validation
├── dashboard/               # Orchestrator + metrics, insights, analytics, and sellers sub-services
├── debtors/                 # Debtor CRUD + credit profile & metrics helpers
├── enums/                   # Shared enums (Role, TransactionType, PaymentType, TransactionStatus)
├── health/                  # Health check (GET /api/health)
├── interfaces/              # Shared TypeScript interfaces (JwtPayload, etc.)
├── markets/                 # Market CRUD + GET /:id/full preview
├── prisma/                  # Prisma v7 client with @prisma/adapter-pg
├── products/                # Product CRUD + atomic restock + period analytics
├── profile/                 # Current-user profile (update info/avatar, change password)
├── sellers/                 # Seller CRUD + GET /:id/full performance & transactions
├── transactions/            # Transactions + pricing/enrichment helpers + payments + full/partial refunds
└── users/                   # User CRUD (ADMIN only) + last-admin protection
api/
└── index.ts                 # Vercel serverless entry (reuses configureApp)
```

## Database Schema

**Models:** `User`, `Market`, `Category`, `Product`, `Debtor`, `Transaction`, `TransactionItem`, `Payment`, `ThrottleBucket`, `IdempotencyRecord`

**Enums:** `Role` (`ADMIN | OWNER | SELLER`), `TransactionType` (`SALE | DEBT | REFUND`), `PaymentType` (`CASH | CARD | CREDIT`), `TransactionStatus` (`PAID | ACTIVE | PARTIAL | REFUNDED | PARTIALLY_REFUNDED`)

Full schema: `prisma/schema.prisma`

## API Endpoints

All endpoints are prefixed with `/api`. Protected endpoints require `Authorization: Bearer <accessToken>`.

### Auth & Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | Public | Login (email/password, throttled 5/min) → `{ accessToken, user }` |
| GET | `/health` | Public | DB health check (`SELECT 1`) |

### Profile

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/profile` | Any | Current user profile |
| PATCH | `/profile` | Any | Update own profile (multipart with optional `image`) |
| PATCH | `/profile/password` | Any | Change password |

### Users (`ADMIN` only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/users` | Create user (multipart with optional `image`) |
| GET | `/users` | List users (search, filter by role, pagination) |
| GET | `/users/:id`, `/users/:id/full` | Get user / user + owned markets + transactions preview |
| PATCH | `/users/:id` | Update user (last-admin demotion protection) |
| DELETE | `/users/:id` | Delete user (last-admin deletion protection) |

### Markets (`ADMIN`, `OWNER`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/markets` | ADMIN | Create market (multipart with optional `image`) |
| GET | `/markets` | ADMIN, OWNER | List markets with enriched KPIs |
| GET | `/markets/:id`, `/markets/:id/full` | ADMIN, OWNER | Get market / market + products, debtors, transactions previews |
| PATCH | `/markets/:id` | ADMIN, OWNER | Update market (OWNER scoped to own market) |
| DELETE | `/markets/:id` | ADMIN | Delete market |

### Products (`ADMIN`, `OWNER`, `SELLER` read)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/products` | ADMIN, OWNER | Create product (multipart with optional `image`) |
| GET | `/products` | ADMIN, OWNER, SELLER | List products enriched with velocity, stock health, and reorder priority |
| GET | `/products/:id` | ADMIN, OWNER, SELLER | Get product with period metrics and comparison |
| PATCH | `/products/:id` | ADMIN, OWNER | Update product (overwrites fields) |
| POST | `/products/:id/restock` | ADMIN, OWNER | Atomically add `quantity` to current stock |
| DELETE | `/products/:id` | ADMIN, OWNER | Delete product |

### Sellers (`ADMIN`, `OWNER`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sellers` | Create seller (multipart with optional `image`) |
| GET | `/sellers` | List sellers with period performance |
| GET | `/sellers/:id`, `/sellers/:id/full` | Get seller / seller + performance + transactions preview |
| PATCH | `/sellers/:id` | Update seller |
| DELETE | `/sellers/:id` | Delete seller |

### Debtors

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/debtors` | Any | Create debtor (`@Idempotent()`) |
| GET | `/debtors` | Any | List debtors with debt summary, overdue days, and risk level |
| GET | `/debtors/:id`, `/debtors/:id/full` | Any | Get debtor / debtor + credit profile + transactions |
| PATCH | `/debtors/:id` | Any | Update debtor |
| DELETE | `/debtors/:id` | ADMIN, OWNER | Delete debtor |

### Transactions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/transactions` | Any (SELLER: `DEBT` only) | Create transaction (`@Idempotent()`) |
| GET | `/transactions` | Any | List transactions + filtered `summary` |
| GET | `/transactions/:id` | Any | Get transaction with items, payments, and refund history |
| PATCH | `/transactions/:id` | ADMIN, OWNER | Update non-finalized transaction |
| DELETE | `/transactions/:id` | ADMIN, OWNER | Delete transaction and restore stock |
| PATCH | `/transactions/:id/pay` | Any | Record full or partial debt payment (`@Idempotent()`) |
| POST | `/transactions/:id/refund` | ADMIN, OWNER | Full or partial sale refund (`@Idempotent()`) |

### Dashboard (`ADMIN`, `OWNER`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard?period=today\|week\|month\|year&dateFrom&dateTo&sellerId` | Full dashboard KPIs, trends, inventory health, debtor aging, top products, pulse, cashflow, heatmaps, and seller leaderboard |
| GET | `/dashboard/sellers-report?period=...` | Per-seller sales, refunds (charged back to original seller), and debts report |

## Environment Variables

See `.env.example` for the full annotated list:

```env
DATABASE_URL="postgresql://user:password@host:5432/db?sslmode=require"
DATABASE_POOL_MAX=10          # on Vercel use 2-3 (each serverless instance keeps its own pool)
JWT_ACCESS_SECRET="your-access-secret"
JWT_ACCESS_EXPIRES_IN="15m"
BCRYPT_ROUNDS=12
PORT=4000                     # project convention: frontend expects :4000
NODE_ENV=development
CLOUDINARY_CLOUD_NAME="..."   CLOUDINARY_API_KEY="..."   CLOUDINARY_API_SECRET="..."
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | `prisma generate` + compile to `dist/` |
| `npm start` | Run production build (`node dist/src/main`) |
| `npm run start:dev` | Development with hot-reload |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Apply pending migrations (dev) |
| `npm run prisma:deploy` | Apply migrations in CI/prod |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run prisma:seed` | Seed database |
| `npm test` | Unit tests (jest + ts-jest, mocked Prisma, no DB) |
| `npm run test:watch` / `test:cov` | Watch mode / coverage |
| `npx tsc --noEmit -p tsconfig.build.json` | Full strict TypeScript check |

## Detailed Contributor Guide

See [AGENTS.md](./AGENTS.md) for architectural conventions, IDOR scoping rules, pagination/period utilities, and CI pipeline details.
