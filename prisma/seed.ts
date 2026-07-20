import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'bcrypt'
import { PrismaClient } from './generated/client'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min

const pick = <T>(arr: T[]): T => arr[randomInt(0, arr.length - 1)]

const debtorsData = [
  { name: 'Ахмед Рахимов', phone: '+79231234567' },
  { name: 'Рустам Каримов', phone: '+79239876543' },
  { name: 'Фаррух Азизов', phone: '+79235551234' },
  { name: 'Джамшид Умаров', phone: '+79237778899' },
  { name: 'Бахром Саидов', phone: '+79234445566' },
  { name: 'Шухрат Мирзаев', phone: '+79236667788' },
  { name: 'Ильхом Нурматов', phone: '+79231112233' },
  { name: 'Собир Холов', phone: '+79239998877' },
  { name: 'Умид Расулов', phone: '+79238889900' },
  { name: 'Даврон Юсупов', phone: '+79233334455' },
  { name: 'Тимур Абдуллаев', phone: '+79232223344' },
  { name: 'Надим Хамидов', phone: '+79237776655' },
]

const productTemplates = [
  { name: 'Хлеб белый', description: 'Свежий белый хлеб', price: 0.8, quantity: 100 },
  { name: 'Молоко 3.2%', description: 'Молоко пастеризованное', price: 1.2, quantity: 60 },
  { name: 'Яйца куриные (10шт)', description: 'Домашние куриные яйца', price: 1.5, quantity: 80 },
  { name: 'Масло сливочное', description: 'Масло 82.5% жирности', price: 3.0, quantity: 30 },
  { name: 'Сыр Российский', description: 'Сыр полутвердый', price: 4.5, quantity: 25 },
  { name: 'Колбаса Докторская', description: 'Вареная колбаса', price: 3.2, quantity: 40 },
  { name: 'Сахар песок', description: 'Сахар белый 1кг', price: 0.9, quantity: 120 },
  { name: 'Рис круглозерный', description: 'Рис 1кг', price: 1.1, quantity: 90 },
  { name: 'Макароны рожки', description: 'Макаронные изделия 500г', price: 0.7, quantity: 150 },
  { name: 'Подсолнечное масло', description: 'Масло рафинированное 1л', price: 1.8, quantity: 50 },
  { name: 'Чай черный', description: 'Чай индийский 100 пакетиков', price: 2.5, quantity: 35 },
  { name: 'Кофе растворимый', description: 'Кофе 200г', price: 5.0, quantity: 20 },
  { name: 'Гречка', description: 'Гречневая крупа 1кг', price: 1.3, quantity: 70 },
  { name: 'Мука пшеничная', description: 'Мука высший сорт 2кг', price: 1.0, quantity: 85 },
  { name: 'Кефир 1%', description: 'Кефир 1л', price: 1.1, quantity: 55 },
  { name: 'Печенье овсяное', description: 'Печенье 400г', price: 1.6, quantity: 45 },
  { name: 'Сок яблочный', description: 'Сок восстановленный 1л', price: 1.4, quantity: 40 },
  { name: 'Вода минеральная', description: 'Вода газированная 1.5л', price: 0.6, quantity: 200 },
  { name: 'Творог 5%', description: 'Творог рассыпчатый 500г', price: 2.2, quantity: 30 },
  { name: 'Шоколад молочный', description: 'Шоколад 100г', price: 1.9, quantity: 60 },
]

async function main() {
  console.log('Seeding database...')

  await prisma.payment.deleteMany()
  await prisma.transactionItem.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.debtor.deleteMany()
  await prisma.product.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.market.deleteMany()
  await prisma.user.deleteMany()

  const hashedPassword = await hash('12345678Aa', 10)

  const admin = await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@tradecrm.com',
      password: hashedPassword,
      role: 'ADMIN',
    },
  })
  console.log(`  Admin: admin@tradecrm.com / 12345678Aa`)

  const markets = [
    { name: 'Рынок Садаф', address: 'ул. Пушкина, 12, Душанбе' },
    { name: 'Рынок Мехригон', address: 'пр. Рудаки, 45, Душанбе' },
  ]

  for (const marketData of markets) {
    const owner = await prisma.user.create({
      data: {
        name: `Владелец ${marketData.name}`,
        email: `owner-${marketData.name.toLowerCase().replace(/\s+/g, '-')}@tradecrm.com`,
        password: hashedPassword,
        role: 'OWNER',
      },
    })

    const market = await prisma.market.create({
      data: {
        name: marketData.name,
        address: marketData.address,
        ownerId: owner.id,
      },
    })

    await prisma.user.update({ where: { id: owner.id }, data: { marketId: market.id } })

    const sellers = [
      { name: `Продавец ${marketData.name} 1` },
      { name: `Продавец ${marketData.name} 2` },
    ]

    for (const sellerData of sellers) {
      const seller = await prisma.user.create({
        data: {
          name: sellerData.name,
          email: `${sellerData.name.toLowerCase().replace(/\s+/g, '-')}@tradecrm.com`,
          password: hashedPassword,
          role: 'SELLER',
          marketId: market.id,
        },
      })
      console.log(`  Seller: ${seller.email} / 12345678Aa`)
    }

    const marketProductTemplates = productTemplates.slice(0, randomInt(8, 12)).map((t) => ({
      ...t,
      quantity: randomInt(10, 200),
    }))

    const products = await Promise.all(
      marketProductTemplates.map((p) =>
        prisma.product.create({
          data: {
            name: p.name,
            description: p.description,
            price: p.price,
            quantity: p.quantity,
            marketId: market.id,
          },
        }),
      ),
    )

    const marketDebtors = debtorsData.slice(0, randomInt(4, 6)).map((d) => ({
      name: d.name,
      phone: d.phone,
      marketId: market.id,
    }))

    const debtors = await Promise.all(
      marketDebtors.map((d) =>
        prisma.debtor.create({ data: d }),
      ),
    )

    const createdBy = await prisma.user.findFirst({
      where: { marketId: market.id, role: 'SELLER' },
    })
    if (!createdBy) throw new Error('No seller found')

    for (let i = 0; i < 12; i++) {
      const isDebt = Math.random() < 0.4
      const itemCount = randomInt(1, 4)
      const selectedProducts = products.sort(() => Math.random() - 0.5).slice(0, itemCount)

      const items = selectedProducts.map((p) => ({
        productId: p.id,
        productName: p.name,
        quantity: randomInt(1, 5),
        price: p.price,
        totalPrice: 0,
      }))

      for (const item of items) {
        item.totalPrice = item.quantity * item.price
      }

      const totalAmount = items.reduce((s, i) => s + i.totalPrice, 0)

      const createdAt = new Date(
        Date.now() - randomInt(0, 60) * 24 * 60 * 60 * 1000 - randomInt(0, 24) * 60 * 60 * 1000,
      )

      if (isDebt) {
        const debtor = pick(debtors)
        const paymentType = pick(['CASH', 'CREDIT'] as const)

        const partialPayChance = Math.random()
        let remainingAmount = totalAmount
        let status: 'ACTIVE' | 'PARTIAL' | 'PAID' = 'ACTIVE'
        const payments: { amount: number; note?: string }[] = []

        if (partialPayChance < 0.3) {
          const payAmount = randomInt(1, Math.max(1, Math.floor(totalAmount * 0.7)))
          remainingAmount = totalAmount - payAmount
          status = remainingAmount <= 0 ? 'PAID' : 'PARTIAL'
          payments.push({ amount: payAmount, note: 'Частичная оплата' })
        } else if (partialPayChance < 0.5) {
          remainingAmount = 0
          status = 'PAID'
          payments.push({ amount: totalAmount, note: 'Полная оплата' })
        }

        const tx = await prisma.transaction.create({
          data: {
            marketId: market.id,
            createdById: createdBy.id,
            debtorId: debtor.id,
            type: 'DEBT',
            paymentType,
            totalAmount,
            remainingAmount,
            status,
            createdAt,
            items: { create: items },
          },
        })

        for (const payment of payments) {
          const paymentDate = new Date(createdAt.getTime() + randomInt(1, 14) * 24 * 60 * 60 * 1000)
          await prisma.payment.create({
            data: {
              transactionId: tx.id,
              amount: payment.amount,
              note: payment.note,
              createdById: createdBy.id,
              createdAt: paymentDate,
            },
          })
        }
      } else {
        const paymentType = pick(['CASH', 'CARD'] as const)

        await prisma.transaction.create({
          data: {
            marketId: market.id,
            createdById: createdBy.id,
            type: 'SALE',
            paymentType,
            totalAmount,
            remainingAmount: 0,
            status: 'PAID',
            createdAt,
            items: { create: items },
          },
        })
      }
    }

    console.log(`  Market "${marketData.name}" — ${products.length} products, ${debtors.length} debtors, 12 transactions`)
  }

  console.log('\nSeeding complete!')
  console.log('Login credentials:')
  console.log('  Admin: admin@tradecrm.com / 12345678Aa')
  console.log('  Owners & Sellers: <email> / 12345678Aa')
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
