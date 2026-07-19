# TradeCRM — CRM для маркетов

## Описание проекта
TradeCRM — это CRM система для управления маркетами, товарами, клиентами и долгами. Заменяет бумажную тетрадь должников на цифровую систему с ролями, поиском и статистикой.

---

## Стек
- **Backend:** NestJS + Prisma ORM + PostgreSQL
- **Frontend:** React + Vite + TypeScript

---

## Роли
| Роль | Описание |
|------|----------|
| `ADMIN` | Полный доступ ко всей системе |
| `OWNER` | Владелец маркета, может быть продавцом, добавляет продавцов |
| `SELLER` | Продавец — только работа с долгами |

---

## Структура Backend (NestJS)

```
src/
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── strategies/
│   │   ├── jwt.strategy.ts
│   │   └── refresh.strategy.ts
│   └── guards/
│       ├── jwt.guard.ts
│       ├── refresh.guard.ts
│       └── roles.guard.ts
│
├── users/
│   ├── users.module.ts
│   ├── users.controller.ts
│   ├── users.service.ts
│   └── dto/
│       ├── create-user.dto.ts
│       └── update-user.dto.ts
│
├── markets/
│   ├── markets.module.ts
│   ├── markets.controller.ts
│   ├── markets.service.ts
│   └── dto/
│
├── products/
│   ├── products.module.ts
│   ├── products.controller.ts
│   ├── products.service.ts
│   └── dto/
│       ├── create-product.dto.ts
│       └── update-product.dto.ts
│
├── debtors/
│   ├── debtors.module.ts
│   ├── debtors.controller.ts
│   ├── debtors.service.ts
│   └── dto/
│
├── transactions/
│   ├── transactions.module.ts
│   ├── transactions.controller.ts
│   ├── transactions.service.ts
│   └── dto/
│       ├── create-transaction.dto.ts
│       └── create-transaction-item.dto.ts
│
└── common/
    ├── decorators/
    │   └── roles.decorator.ts
    ├── enums/
    │   ├── role.enum.ts
    │   ├── payment-type.enum.ts
    │   └── status.enum.ts
    └── pipes/
        └── validation.pipe.ts
```

---

## База данных (Prisma Schema)

```prisma
model User {
  id        String   @id @default(uuid())
  name      String
  email     String   @unique
  password  String
  role      Role
  marketId  String?
  market    Market?  @relation(fields: [marketId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  transactions Transaction[]
}

model Market {
  id        String   @id @default(uuid())
  name      String
  address   String
  ownerId   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users        User[]
  products     Product[]
  debtors      Debtor[]
  transactions Transaction[]
}

model Product {
  id        String   @id @default(uuid())
  name      String
  price     Float
  quantity  Int
  marketId  String
  market    Market   @relation(fields: [marketId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  transactionItems TransactionItem[]
}

model Debtor {
  id        String   @id @default(uuid())
  name      String
  phone     String
  marketId  String
  market    Market   @relation(fields: [marketId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  transactions Transaction[]
}

model Transaction {
  id          String        @id @default(uuid())
  marketId    String
  market      Market        @relation(fields: [marketId], references: [id])
  createdById String
  createdBy   User          @relation(fields: [createdById], references: [id])
  debtorId    String?
  debtor      Debtor?       @relation(fields: [debtorId], references: [id])
  type        TransactionType
  paymentType PaymentType
  totalAmount Float
  status      TransactionStatus
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  items TransactionItem[]
}

model TransactionItem {
  id            String      @id @default(uuid())
  transactionId String
  transaction   Transaction @relation(fields: [transactionId], references: [id])
  productId     String
  product       Product     @relation(fields: [productId], references: [id])
  productName   String
  quantity      Int
  price         Float
  totalPrice    Float
}

enum Role {
  ADMIN
  OWNER
  SELLER
}

enum TransactionType {
  SALE
  DEBT
}

enum PaymentType {
  CASH
  CARD
  CREDIT
}

enum TransactionStatus {
  PAID
  ACTIVE
  PARTIAL
}
```

---

## API Endpoints

```
AUTH
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

USERS (Admin only)
GET    /users
POST   /users
PATCH  /users/:id
DELETE /users/:id

MARKETS
GET    /markets
POST   /markets           ← Admin
PATCH  /markets/:id       ← Admin
DELETE /markets/:id       ← Admin

PRODUCTS
GET    /products?marketId=
POST   /products          ← Admin + Owner
PATCH  /products/:id      ← Admin + Owner
DELETE /products/:id      ← Admin + Owner

DEBTORS
GET    /debtors?marketId=&search=
POST   /debtors           ← Admin + Owner
PATCH  /debtors/:id       ← Admin + Owner
DELETE /debtors/:id       ← Admin + Owner
GET    /debtors/:id/debts
GET    /debtors/:id/total

TRANSACTIONS
GET    /transactions?marketId=&type=&status=
POST   /transactions
PATCH  /transactions/:id/pay
GET    /transactions/:id
```

---

## Права доступа

| Модуль | Admin | Owner | Seller |
|--------|-------|-------|--------|
| Users | CRUD | - | - |
| Markets | CRUD | READ | - |
| Products | CRUD | CRUD | READ |
| Debtors | CRUD | CRUD | READ |
| Transactions | CRUD | CRUD | CREATE + PAY |

---

## Порядок разработки

```
1. ✅ Инициализация (NestJS + Prisma + PostgreSQL)
2. ⬜ Common (enums, guards, decorators)
3. ⬜ Auth (JWT access + refresh)
4. ⬜ Users module
5. ⬜ Markets module
6. ⬜ Products module
7. ⬜ Debtors module
8. ⬜ Transactions module
```

---

## Команды для старта

```bash
# Создать проект
npm i -g @nestjs/cli
nest new tradecrm-backend

# Установить зависимости
npm install prisma @prisma/client
npm install @nestjs/jwt @nestjs/passport passport passport-jwt passport-local
npm install bcrypt class-validator class-transformer
npm install @nestjs/config

# Инициализировать Prisma
npx prisma init

# После schema.prisma готова
npx prisma migrate dev --name init
npx prisma generate
```

---

## .env файл

```env
DATABASE_URL="postgresql://user:password@localhost:5432/tradecrm"
JWT_ACCESS_SECRET="your_access_secret"
JWT_REFRESH_SECRET="your_refresh_secret"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
PORT=3000
```
