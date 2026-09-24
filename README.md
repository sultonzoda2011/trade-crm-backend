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
| Runtime | Node.js 18+ |
| Language | TypeScript (strict) |
| Framework | NestJS v11 (Express 5) |
| Database | PostgreSQL (pg driver pool, `DATABASE_POOL_MAX`) |
| ORM | Prisma v7 |
| Auth | JWT access token (bcrypt, passport) |
| Validation | class-validator + class-transformer |
| Security | helmet, @nestjs/throttler, idempotency keys |
| API Docs | Swagger / OpenAPI |
| File Storage | Cloudinary |
| Tests | jest + ts-jest (mocked Prisma, no DB) |
| CI | GitHub Actions (typecheck → tests → migrate deploy → audit) |
| Deploy | Vercel (serverless, Node 20) |

## Features

- JWT authentication (`POST /auth/login` returns access token + user in body; cookies are no longer used)
- Role-based access control: `ADMIN`, `OWNER`, `SELLER`; global JWT guard with `@Public()` bypass
- CRUD for users, markets, categories, products, sellers, debtors, and transactions
- Debt tracking with partial payment recording and refunds (`ACTIVE / PARTIAL / PAID / REFUNDED / PARTIALLY_REFUNDED`)
- Seller balances and credit operations (`SellerCredit`)
- Image upload for markets and products (JPEG, PNG, WebP, GIF; max 5MB) via Cloudinary
- Dashboard: KPI stats, overview, revenue trend (`day`/`month` buckets), payment-type distribution, sellers report
- Search, filtering, and pagination across all entities
- Automatic data scoping per user's market (IDOR protection)
- Idempotent transaction creation via `IdempotencyKey`
- Rate limiting (throttler with DB-backed `ThrottleBucket`), login throttled to 5/min
- Standardized JSON responses (`success`, `data`, `timestamp`) via global interceptor
- Health check endpoint (`GET /health`)

## Architecture

```
src/
├── main.ts                  # Local entry point (bootstrap() + listen)
├── bootstrap.ts             # configureApp(): all shared app configuration
├── app.module.ts            # Root module
├── analytics/               # Shared analytics service (dashboard/products reuse it)
├── auth/                    # Auth module (JWT, guards, strategies, decorators)
├── categories/              # Product category CRUD
├── common/                  # Shared: filters, interceptors (incl. idempotency), pipes, decorators
├── config/                  # Environment validation
├── dashboard/               # KPI stats, overview, revenue trend, payment distribution, sellers report
├── debtors/                 # Debtor CRUD
├── enums/                   # Shared enums
├── health/                  # Health check
├── interfaces/              # Shared interfaces
├── markets/                 # Market CRUD with image upload
├── prisma/                  # Prisma client (global module)
├── products/                # Product CRUD with image upload
├── profile/                 # Current-user profile (update, change password)
├── sellers/                 # Seller CRUD + balance + credits
├── transactions/            # Transactions + payments + refunds
└── users/                   # User CRUD (admin only)
api/
└── index.ts                 # Vercel serverless entry (reuses configureApp)
```

Patterns: modular design, repository pattern via PrismaService, RBAC via `@Roles()` decorator,
response transformation interceptor, global exception filter. Single app configuration in
`src/bootstrap.ts` shared by both entry points (local + serverless).

## Database Schema

**Models:** User, Market, Category, Product, Debtor, Transaction, TransactionItem, Payment,
SellerCredit, IdempotencyKey, ThrottleBucket

**Enums:** `Role` (ADMIN/OWNER/SELLER), `TransactionType` (SALE/DEBT/REFUND),
`PaymentType` (CASH/CARD/CREDIT), `TransactionStatus` (PAID/ACTIVE/PARTIAL/REFUNDED/PARTIALLY_REFUNDED),
`ProductUnit` (PCS/KG/L/M/BOX)

- Market belongs to an owner (User); Products, Debtors, Transactions are scoped to a Market
- Transactions have items (snapshot of product, quantity, price) and optional payments
- Payments reduce `remainingAmount` and update `status`
- Cascade deletes and indexes configured per audit fixes (July 2026)

Full schema: `prisma/schema.prisma`

## API Endpoints

All endpoints are prefixed with `/api`. Protected endpoints require `Authorization: Bearer <accessToken>`.

### Auth & Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | Public | Login (email/password, throttled 5/min) → `{ accessToken, user }` |
| GET | `/health` | Public | DB health check |

### Profile

| Method | Path | Description |
|--------|------|-------------|
| GET | `/profile` | Current user |
| GET | `/profile/full` | Current user (expanded) |
| PATCH | `/profile` | Update own profile |
| PATCH | `/profile/password` | Change password |

### Users (admin only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/users` | Create user |
| GET | `/users` | List users (search, filter by role, pagination) |
| GET | `/users/:id`, `/users/:id/full` | Get user |
| PATCH | `/users/:id` | Update user |
| DELETE | `/users/:id` | Delete user (last-admin protection) |

### Markets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/markets` | ADMIN | Create market (multipart with image) |
| GET | `/markets` | Any | List markets |
| GET | `/markets/:id`, `/markets/:id/full` | Any | Get market |
| PATCH | `/markets/:id` | ADMIN | Update market |
| DELETE | `/markets/:id` | ADMIN | Delete market |

### Categories, Products, Debtors, Sellers

CRUD endpoints scoped to the authenticated user's market:

- `GET|POST /api/categories`, `/api/categories/:id`, `/api/categories/:id/full`
- `GET|POST /api/products`, `/api/products/:id`
- `GET|POST /api/debtors`, `/api/debtors/:id`, `/api/debtors/:id/full`
- `GET|POST /api/sellers`, `/api/sellers/:id`, `/api/sellers/:id/full`
- `GET /api/sellers/:id/balance` — seller balance
- `POST|GET /api/sellers/:id/credits` — record / list credit operations

### Transactions

- `GET|POST /api/transactions`, `/api/transactions/:id`, `/api/transactions/:id/detail`
- `PATCH /api/transactions/:id` — update
- `DELETE /api/transactions/:id` — delete
- `PATCH /api/transactions/:id/pay` — record a payment against a debt
- `POST /api/transactions/:id/refund` — refund a sale (full or partial)

`POST /api/transactions` supports idempotency keys (dedup repeated submissions).

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard?period=day\|week\|month\|year` | KPI stats |
| GET | `/dashboard/overview?period=...` | Revenue trend + `paymentDistribution` (CASH/CARD/CREDIT: count, amount, % of revenue) |
| GET | `/dashboard/sellers-report?period=...` | Revenue/debt/refund/cheque stats per seller |

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

## Auth Flow

1. `POST /api/auth/login` with email/password → returns `{ accessToken, user }`
2. Send `Authorization: Bearer <accessToken>` for protected endpoints
3. On expiry re-login (no refresh-token rotation; cookies are not used)

## Project Status

Early development (v0.1.0). Unit tests run without a database (Prisma is mocked); see `AGENTS.md`
for detailed contributor guidelines, CI pipeline description, and TypeScript strictness settings.
