# TradeCRM Backend

**v0.1.0** — RESTful CRM API for managing markets and bazaars. Built with NestJS, Prisma, and PostgreSQL.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Language | TypeScript |
| Framework | NestJS v11 (Express) |
| Database | PostgreSQL |
| ORM | Prisma v7 |
| Auth | JWT + refresh tokens (bcrypt, passport) |
| Validation | class-validator + class-transformer |
| API Docs | Swagger / OpenAPI |
| File Storage | Local filesystem (`uploads/`) |

## Features

- JWT authentication with refresh token rotation and logout
- Role-based access control: `ADMIN`, `OWNER`, `SELLER`
- CRUD for users, markets, products, debtors, and transactions
- Debt tracking with partial payment recording
- Image upload for markets and products (JPEG, PNG, WebP, GIF; max 5MB)
- Search, filtering, and pagination across all entities
- Automatic data scoping per user's market
- Standardized JSON responses (`success`, `data`, `timestamp`)
- Swagger API documentation

## Architecture

```
src/
├── main.ts                  # Entry point
├── app.module.ts            # Root module
├── config/                  # Environment validation
├── prisma/                  # Prisma client (global module)
├── auth/                    # Auth module (JWT, guards, strategies, decorators)
├── users/                   # User CRUD (admin only)
├── markets/                 # Market CRUD with image upload
├── products/                # Product CRUD with image upload
├── debtors/                 # Debtor CRUD
├── transactions/            # Transactions + payments
├── common/                  # Shared: filters, interceptors, pipes, decorators
├── enums/                   # Shared enums
└── interfaces/              # Shared interfaces
```

Patterns: modular design, repository pattern via PrismaService, global JWT guard with `@Public()` bypass, RBAC via `@Roles()` decorator, response transformation interceptor, global exception filter.

## Database Schema

**Models:** User, RefreshToken, Market, Product, Debtor, Transaction, TransactionItem, Payment

- Market belongs to an owner (User)
- Products, Debtors, Transactions are scoped to a Market
- Transactions have items (snapshot of product, quantity, price) and optional payments
- Payments reduce `remainingAmount` and update `status` (ACTIVE / PARTIAL / PAID)

Full schema: `prisma/schema.prisma`

## API Endpoints

All endpoints are prefixed with `/api`.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | Public | Login (returns access + refresh tokens) |
| POST | `/auth/refresh` | Public | Refresh access token |
| POST | `/auth/logout` | Bearer | Revoke refresh token |

### Users (admin only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/users` | Create user |
| GET | `/users` | List users (search, filter by role, pagination) |
| GET | `/users/:id` | Get user by ID |
| PATCH | `/users/:id` | Update user |
| DELETE | `/users/:id` | Delete user |

### Markets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/markets` | ADMIN | Create market (multipart with image) |
| GET | `/markets` | Any | List markets |
| GET | `/markets/:id` | Any | Get market by ID |
| PATCH | `/markets/:id` | ADMIN | Update market |
| DELETE | `/markets/:id` | ADMIN | Delete market |

### Products, Debtors, Transactions

CRUD endpoints scoped to the authenticated user's market:

- `GET|POST /api/products`, `/api/products/:id`
- `GET|POST /api/debtors`, `/api/debtors/:id`
- `GET|POST /api/transactions`, `/api/transactions/:id`
- `PATCH /api/transactions/:id/pay` — record a payment against a debt

## Setup

### Prerequisites

- Node.js 18+
- npm
- PostgreSQL database

### Installation

```bash
git clone <repo-url>
cd backend
npm install
```

### Environment Variables

Create a `.env` file:

```env
DATABASE_URL="postgresql://user:password@host:5432/db"
JWT_ACCESS_SECRET="your-access-secret"
JWT_REFRESH_SECRET="your-refresh-secret"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="30d"
PORT=4000
NODE_ENV=development
```

### Database Setup

```bash
npx prisma generate
npx prisma migrate dev
```

### Seed Data

```bash
npm run prisma:seed
```

Default credentials: `admin@tradecrm.com` / `12345678Aa`

### Run

```bash
npm run start:dev
```

API: `http://localhost:4000/api`  
Swagger docs: `http://localhost:4000/api/docs`

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile to `dist/` |
| `npm start` | Run production build |
| `npm run start:dev` | Development with hot-reload |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run pending migrations |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run prisma:seed` | Seed database |

## Auth Flow

1. `POST /auth/login` with email/password → returns `{ accessToken, refreshToken, user }`
2. Send `Authorization: Bearer <accessToken>` for protected endpoints
3. When the access token expires, `POST /auth/refresh` with the refresh token body → new token pair
4. `POST /auth/logout` revokes the refresh token

## Project Status

Early development (v0.1.0). No test infrastructure yet.
