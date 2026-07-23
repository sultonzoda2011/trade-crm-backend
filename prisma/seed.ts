import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/client'
import { hash } from 'bcrypt'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL as string })
const prisma = new PrismaClient({ adapter })

const MARKET_NAMES = [
  'Метро', 'Ашан', 'Сільпо', 'АТБ', 'Novus',
  'Фора', 'Епіцентр', 'МегаМаркет', 'Varus', 'SPAR',
]

const CITIES = [
  'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань',
  'Нижний Новгород', 'Челябинск', 'Самара', 'Ростов-на-Дону', 'Уфа',
]

const STREETS = [
  'Ленина', 'Советская', 'Пушкина', 'Гагарина',
  'Мира', 'Кирова', 'Октябрьская', 'Победы',
  'Комсомольская', 'Лермонтова', 'Толстого', 'Чехова',
]

const OWNER_NAMES = [
  'Александр Ковалёв', 'Елена Шевченко', 'Михаил Бондаренко',
  'Ирина Ткаченко', 'Сергей Кравченко', 'Наталья Олейник',
  'Андрей Мельник', 'Татьяна Лысенко', 'Дмитрий Гончарук', 'Людмила Павленко',
]

const SELLER_NAMES = [
  'Василий Петренко', 'Мария Иваненко', 'Пётр Сидоренко', 'Ксения Коваль',
  'Иван Бойко', 'Анна Мороз', 'Тарас Литвин', 'Юлия Савченко',
  'Богдан Руденко', 'Светлана Гриценко', 'Роман Данилюк', 'Екатерина Мартынюк',
  'Владимир Кузьменко', 'Ольга Пономаренко', 'Евгений Романенко', 'Лариса Гаврилюк',
  'Максим Ткачук', 'Надежда Левченко', 'Виталий Марченко', 'Зоя Ищенко',
  'Артём Семенюк', 'Валентина Гордиенко', 'Денис Черновол', 'Татьяна Антоненко',
  'Олег Герасименко', 'Инна Терещенко', 'Руслан Дорошенко', 'Нина Яковенко',
  'Юрий Пилипенко', 'Алла Федоренко', 'Игорь Назаренко', 'Вера Тимошенко',
]

const DEBTOR_FIRST_NAMES = [
  'Пётр', 'Олег', 'Иван', 'Василий', 'Михаил', 'Андрей', 'Николай', 'Сергей',
  'Дмитрий', 'Владимир', 'Тарас', 'Роман', 'Евгений', 'Богдан', 'Максим',
]

const DEBTOR_LAST_NAMES = [
  'Шевченко', 'Бондаренко', 'Коваленко', 'Ткаченко', 'Кравченко',
  'Олейник', 'Мельник', 'Лысенко', 'Гончарук', 'Павленко',
  'Петренко', 'Сидоренко', 'Коваль', 'Бойко', 'Мороз',
]

const PRODUCT_CATEGORIES: { name: string; items: { name: string; price: number }[] }[] = [
  {
    name: 'Молочные продукты',
    items: [
      { name: 'Молоко "Домашнее" 1л', price: 42 },
      { name: 'Сметана 15% 400г', price: 38 },
      { name: 'Сыр твёрдый "Гауда" 200г', price: 89 },
      { name: 'Кефир 2.5% 1л', price: 35 },
      { name: 'Масло сливочное 200г', price: 62 },
      { name: 'Йогурт питьевой 500мл', price: 28 },
      { name: 'Творог 250г', price: 45 },
      { name: 'Сливки 20% 200мл', price: 32 },
    ],
  },
  {
    name: 'Хлебобулочные изделия',
    items: [
      { name: 'Хлеб пшеничный', price: 22 },
      { name: 'Батон нарезной', price: 25 },
      { name: 'Хлеб ржаной', price: 24 },
      { name: 'Булочка с маком', price: 15 },
      { name: 'Круассан с шоколадом', price: 32 },
      { name: 'Лаваш армянский', price: 28 },
    ],
  },
  {
    name: 'Мясные изделия',
    items: [
      { name: 'Колбаса "Докторская" 500г', price: 145 },
      { name: 'Сосиски "Молочные" 400г', price: 89 },
      { name: 'Сало солёное 300г', price: 78 },
      { name: 'Филе куриное 1кг', price: 165 },
      { name: 'Ветчина 300г', price: 112 },
      { name: 'Паштет печёночный 200г', price: 48 },
      { name: 'Котлеты домашние 500г', price: 96 },
    ],
  },
  {
    name: 'Напитки',
    items: [
      { name: 'Сок апельсиновый 1л', price: 45 },
      { name: 'Вода минеральная 1.5л', price: 18 },
      { name: 'Кока-кола 0.5л', price: 20 },
      { name: 'Пиво светлое 0.5л', price: 38 },
      { name: 'Чай зелёный 25 пак.', price: 42 },
      { name: 'Кофе молотый 250г', price: 128 },
      { name: 'Лимонад 1л', price: 22 },
    ],
  },
  {
    name: 'Бакалея',
    items: [
      { name: 'Рис шлифованный 1кг', price: 52 },
      { name: 'Гречка 1кг', price: 35 },
      { name: 'Макароны 400г', price: 22 },
      { name: 'Сахар 1кг', price: 28 },
      { name: 'Масло подсолнечное 1л', price: 55 },
      { name: 'Мука пшеничная 1кг', price: 22 },
      { name: 'Соль экстра 1кг', price: 12 },
      { name: 'Специи набор 30г', price: 25 },
    ],
  },
  {
    name: 'Кондитерские изделия',
    items: [
      { name: 'Печенье "Юбилейное" 300г', price: 38 },
      { name: 'Шоколад "Корона" 100г', price: 65 },
      { name: 'Вафли "Артек" 200г', price: 32 },
      { name: 'Конфеты "Ромашка" 250г', price: 48 },
      { name: 'Мёд гречишный 500г', price: 95 },
      { name: 'Зефир белый 250г', price: 42 },
    ],
  },
  {
    name: 'Бытовая химия',
    items: [
      { name: 'Стиральный порошок 1.5кг', price: 145 },
      { name: 'Мыло жидкое 500мл', price: 32 },
      { name: 'Средство для мытья посуды 500мл', price: 38 },
      { name: 'Освежитель воздуха 300мл', price: 55 },
      { name: 'Туалетная бумага "Софт" 8шт', price: 48 },
    ],
  },
  {
    name: 'Фрукты и овощи',
    items: [
      { name: 'Яблоки 1кг', price: 25 },
      { name: 'Бананы 1кг', price: 38 },
      { name: 'Картофель 1кг', price: 12 },
      { name: 'Лук репчатый 1кг', price: 15 },
      { name: 'Морковь 1кг', price: 14 },
      { name: 'Апельсины 1кг', price: 42 },
      { name: 'Лимон 1шт', price: 12 },
    ],
  },
]

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number, decimals = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals))
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomItems<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function randomDate(startMonthsAgo = 6): Date {
  const now = Date.now()
  const start = now - startMonthsAgo * 30 * 24 * 60 * 60 * 1000
  return new Date(start + Math.random() * (now - start))
}

function generatePhone(): string {
  const prefix = randomItem(['067', '095', '063', '050', '099', '073', '093'])
  const body = String(randomInt(1000000, 9999999))
  return `${prefix}${body}`
}

async function main() {
  console.log('🔧 Clearing existing data...')
  await prisma.refreshToken.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.transactionItem.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.product.deleteMany()
  await prisma.debtor.deleteMany()
  await prisma.user.updateMany({ data: { marketId: null } })
  await prisma.market.deleteMany()
  await prisma.user.deleteMany()

  const hashPassword = (await hash('12345678Aa', 10))

  console.log('🔑 Creating admin...')
  const admin = await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@tradecrm.com',
      password: hashPassword,
      role: 'ADMIN',
    },
  })
  console.log(`  ✓ Admin created: ${admin.email}`)

  const allUsers: { id: string; name: string; email: string }[] = [admin]
  const allMarkets: { id: string; name: string }[] = []
  const allProducts: { id: string; name: string; marketId: string; price: number }[] = []
  const allDebtors: { id: string; name: string; marketId: string }[] = []

  const marketCount = 8
  console.log(`\n🏪 Creating ${marketCount} markets...`)

  for (let m = 0; m < marketCount; m++) {
    const marketName = MARKET_NAMES[m]
    const city = CITIES[m]
    const street = randomItem(STREETS)
    const building = randomInt(1, 120)
    const address = `${city}, ул. ${street}, ${building}`

    const ownerName = OWNER_NAMES[m]
    const ownerEmail = `owner${m + 1}@tradecrm.com`

    const owner = await prisma.user.create({
      data: {
        name: ownerName,
        email: ownerEmail,
        password: hashPassword,
        role: 'OWNER',
      },
    })

    const market = await prisma.market.create({
      data: {
        name: marketName,
        address,
        ownerId: owner.id,
      },
    })

    allUsers.push(owner)
    allMarkets.push({ id: market.id, name: marketName })

    const sellerCount = randomInt(3, 5)
    const sellerNames = randomItems(SELLER_NAMES, sellerCount)
    for (let s = 0; s < sellerCount; s++) {
      const sellerName = sellerNames[s]
      const sellerEmail = `seller${m + 1}_${s + 1}@tradecrm.com`

      const seller = await prisma.user.create({
        data: {
          name: sellerName,
          email: sellerEmail,
          password: hashPassword,
          role: 'SELLER',
          marketId: market.id,
        },
      })
      allUsers.push(seller)
    }

    const allCategoryItems = PRODUCT_CATEGORIES.flatMap((c) => c.items)
    const selectedProducts = randomItems(allCategoryItems, randomInt(15, 22))
    for (const item of selectedProducts) {
      const product = await prisma.product.create({
        data: {
          name: item.name,
          price: item.price,
          quantity: randomInt(10, 500),
          marketId: market.id,
        },
      })
      allProducts.push({ id: product.id, name: product.name, marketId: market.id, price: product.price })
    }

    const debtorCount = randomInt(8, 14)
    for (let d = 0; d < debtorCount; d++) {
      const firstName = randomItem(DEBTOR_FIRST_NAMES)
      const lastName = randomItem(DEBTOR_LAST_NAMES)
      const debtor = await prisma.debtor.create({
        data: {
          name: `${firstName} ${lastName}`,
          phone: generatePhone(),
          marketId: market.id,
        },
      })
      allDebtors.push({ id: debtor.id, name: debtor.name, marketId: market.id })
    }

    const marketUsers = allUsers.filter((u) => u.id === owner.id || (u as any).marketId === market.id)
    const marketProducts = allProducts.filter((p) => p.marketId === market.id)
    const marketDebtors = allDebtors.filter((d) => d.marketId === market.id)

    const transactionCount = randomInt(35, 55)
    for (let t = 0; t < transactionCount; t++) {
      const type = Math.random() < 0.3 ? 'DEBT' : 'SALE'
      const paymentType = randomItem(['CASH', 'CARD', 'CREDIT'] as const)
      const createdBy = randomItem(marketUsers)
      const debtor = type === 'DEBT' ? randomItem(marketDebtors) : (Math.random() < 0.15 ? randomItem(marketDebtors) : null)

      const itemCount = randomInt(1, 5)
      const selectedForTx = randomItems(marketProducts, itemCount)
      let totalAmount = 0
      const items: { productId: string; productName: string; quantity: number; price: number; totalPrice: number }[] = []

      for (const prod of selectedForTx) {
        const qty = randomInt(1, 10)
        const price = prod.price + randomFloat(-5, 5, 2)
        const totalPrice = parseFloat((qty * price).toFixed(2))
        totalAmount += totalPrice
        items.push({
          productId: prod.id,
          productName: prod.name,
          quantity: qty,
          price,
          totalPrice,
        })
      }
      totalAmount = parseFloat(totalAmount.toFixed(2))

      let status: 'PAID' | 'ACTIVE' | 'PARTIAL'
      let remainingAmount = 0
      let paymentAmount = 0

      if (type === 'DEBT') {
        status = randomItem(['ACTIVE', 'PARTIAL'] as const)
        if (status === 'PARTIAL') {
          paymentAmount = randomFloat(0.1 * totalAmount, 0.7 * totalAmount)
          remainingAmount = parseFloat((totalAmount - paymentAmount).toFixed(2))
        } else {
          remainingAmount = totalAmount
        }
      } else {
        status = Math.random() < 0.7 ? 'PAID' : randomItem(['PARTIAL', 'ACTIVE'] as const)
        if (status === 'PAID') {
          paymentAmount = totalAmount
        } else if (status === 'PARTIAL') {
          paymentAmount = randomFloat(0.1 * totalAmount, 0.7 * totalAmount)
          remainingAmount = parseFloat((totalAmount - paymentAmount).toFixed(2))
        } else {
          remainingAmount = totalAmount
        }
      }

      const createdAt = randomDate()

      const transaction = await prisma.transaction.create({
        data: {
          marketId: market.id,
          createdById: createdBy.id,
          debtorId: debtor?.id ?? null,
          type: type as any,
          paymentType: paymentType as any,
          totalAmount,
          remainingAmount,
          status: status as any,
          createdAt,
          items: {
            createMany: {
              data: items.map((i) => ({
                productId: i.productId,
                productName: i.productName,
                quantity: i.quantity,
                price: i.price,
                totalPrice: i.totalPrice,
              })),
            },
          },
        },
      })

      if (paymentAmount > 0) {
        const paymentUser = randomItem(marketUsers)
        await prisma.payment.create({
          data: {
            transactionId: transaction.id,
            amount: paymentAmount,
            createdById: paymentUser.id,
            createdAt: new Date(createdAt.getTime() + randomInt(1, 60) * 60 * 1000),
          },
        })
      }
    }

    console.log(`  ✓ ${marketName} (${city}): ${sellerCount} sellers, ${selectedProducts.length} products, ${debtorCount} debtors, ${transactionCount} transactions`)
  }

  const totalUsers = await prisma.user.count()
  const totalMarkets = await prisma.market.count()
  const totalProducts = await prisma.product.count()
  const totalDebtors = await prisma.debtor.count()
  const totalTransactions = await prisma.transaction.count()
  const totalTransactionItems = await prisma.transactionItem.count()
  const totalPayments = await prisma.payment.count()

  console.log('\n✅ Seed completed successfully!')
  console.log('──────────────────────────────')
  console.log(`  Users:        ${totalUsers}`)
  console.log(`  Markets:      ${totalMarkets}`)
  console.log(`  Products:     ${totalProducts}`)
  console.log(`  Debtors:      ${totalDebtors}`)
  console.log(`  Transactions: ${totalTransactions}`)
  console.log(`  Items:        ${totalTransactionItems}`)
  console.log(`  Payments:     ${totalPayments}`)
  console.log('──────────────────────────────')
  console.log('  Admin: admin@tradecrm.com / 12345678Aa')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
