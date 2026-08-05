import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, ProductUnit } from './generated/client'
import { hash } from 'bcrypt'
import { v2 as cloudinary } from 'cloudinary'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

const PNG_DIR = join(process.cwd(), 'prisma', 'png')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const PNG_FILES = readdirSync(PNG_DIR)
  .filter((f) => f.endsWith('.png'))
  .sort()

let imageIndex = 0

function nextImage(): string | null {
  if (PNG_FILES.length === 0) return null
  const file = PNG_FILES[imageIndex % PNG_FILES.length]
  imageIndex++
  return file
}

const imageCache = new Map<string, string>()

async function uploadImage(fileName: string | null): Promise<string | null> {
  if (!fileName) return null
  if (imageCache.has(fileName)) return imageCache.get(fileName)!
  if (!process.env.CLOUDINARY_CLOUD_NAME) return null
  const filePath = join(PNG_DIR, fileName)
  if (!existsSync(filePath)) return null
  const buffer = readFileSync(filePath)
  const result = await cloudinary.uploader.upload(
    `data:image/png;base64,${buffer.toString('base64')}`,
    {
      folder: 'tradecrm/seed',
      public_id: fileName.replace(/\.[^.]+$/, ''),
      resource_type: 'image',
    },
  )
  imageCache.set(fileName, result.secure_url)
  return result.secure_url
}

async function clearTables() {
  await prisma.payment.deleteMany()
  await prisma.transactionItem.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.product.deleteMany()
  await prisma.category.deleteMany()
  await prisma.debtor.deleteMany()
  await prisma.user.updateMany({ data: { marketId: null } })
  await prisma.market.deleteMany()
  await prisma.user.deleteMany()
}

async function createAdmin() {
  const password = await hash('12345678Aa', 10)
  return prisma.user.create({
    data: {
      name: 'Администратор',
      email: 'admin@tradecrm.com',
      password,
      role: 'ADMIN',
      image: await uploadImage(nextImage()),
    },
  })
}

interface MarketUsers {
  market: { id: string }
  owner: { id: string }
  sellers: { id: string; name: string }[]
}

async function createMarket1(): Promise<MarketUsers> {
  const password = await hash('12345678Aa', 10)
  const owner = await prisma.user.create({
    data: { name: 'Алишер Каримов', email: 'alisher@tradecrm.com', password, role: 'OWNER', image: await uploadImage(nextImage()) },
  })
  const market = await prisma.market.create({
    data: { name: 'Рынок Центральный', address: 'ул. Ленина, 15, г. Ташкент', ownerId: owner.id, image: await uploadImage(nextImage()) },
  })
  await prisma.user.update({ where: { id: owner.id }, data: { marketId: market.id } })
  const s1 = await prisma.user.create({
    data: { name: 'Бахтияр Рахимов', email: 'bakhtiyar@tradecrm.com', password, role: 'SELLER', marketId: market.id, image: await uploadImage(nextImage()) },
  })
  const s2 = await prisma.user.create({
    data: { name: 'Мадина Юсупова', email: 'madina@tradecrm.com', password, role: 'SELLER', marketId: market.id, image: await uploadImage(nextImage()) },
  })
  return { market, owner, sellers: [s1, s2] }
}

async function createMarket2(): Promise<MarketUsers> {
  const password = await hash('12345678Aa', 10)
  const owner = await prisma.user.create({
    data: { name: 'Дилноза Азимова', email: 'dilnoza@tradecrm.com', password, role: 'OWNER', image: await uploadImage(nextImage()) },
  })
  const market = await prisma.market.create({
    data: { name: 'Рынок Восточный', address: 'ул. Амира Темура, 42, г. Ташкент', ownerId: owner.id, image: await uploadImage(nextImage()) },
  })
  await prisma.user.update({ where: { id: owner.id }, data: { marketId: market.id } })
  const s1 = await prisma.user.create({
    data: { name: 'Жасур Ахмедов', email: 'jasur@tradecrm.com', password, role: 'SELLER', marketId: market.id, image: await uploadImage(nextImage()) },
  })
  const s2 = await prisma.user.create({
    data: { name: 'Нигора Камилова', email: 'nigora@tradecrm.com', password, role: 'SELLER', marketId: market.id, image: await uploadImage(nextImage()) },
  })
  return { market, owner, sellers: [s1, s2] }
}

const categoryData1 = [
  { name: 'Молочные продукты', description: 'Свежие молоко, йогурты, сыры и творог от местных ферм' },
  { name: 'Хлебобулочные изделия', description: 'Свежая выпечка, хлеб и лепёшки каждый день' },
  { name: 'Овощи и фрукты', description: 'Сезонные овощи и фрукты напрямую с базара' },
  { name: 'Мясо и птица', description: 'Свежее мясо, птица и мясные полуфабрикаты' },
  { name: 'Бакалея', description: 'Сахар, мука, масло и другие товары повседневного спроса' },
]

async function createCategories(marketId: string, list: typeof categoryData1) {
  return Promise.all(
    list.map(async (c) =>
      prisma.category.create({
        data: {
          name: c.name,
          description: c.description,
          marketId,
          image: await uploadImage(nextImage()),
        },
      }),
    ),
  )
}

const categoryData2 = [
  { name: 'Напитки', description: 'Вода, соки, газированные и горячие напитки' },
  { name: 'Кондитерские изделия', description: 'Шоколад, конфеты, зефир и другие сладости' },
  { name: 'Морепродукты', description: 'Свежая и мороженая рыба, креветки и мидии' },
  { name: 'Крупы и макароны', description: 'Крупы, макаронные изделия и бобовые' },
  { name: 'Консервация', description: 'Консервы, маринады и томатная паста' },
]

const market1Products = [
  { name: 'Молоко свежее', description: 'Жирность 3.2%, 1л', price: 8000, unit: ProductUnit.L, quantity: 50 },
  { name: 'Кефир', description: 'Жирность 2.5%, 1л', price: 7000, unit: ProductUnit.L, quantity: 40 },
  { name: 'Сметана', description: 'Жирность 20%, 400г', price: 12000, unit: ProductUnit.PCS, quantity: 30 },
  { name: 'Творог', description: 'Жирность 5%, 250г', price: 15000, unit: ProductUnit.PCS, quantity: 25 },
  { name: 'Сыр твёрдый', description: 'Голландский, 1кг', price: 85000, unit: ProductUnit.KG, quantity: 10 },
  { name: 'Йогурт питьевой', description: 'Клубничный, 0.5л', price: 6000, unit: ProductUnit.PCS, quantity: 60 },
  { name: 'Хлеб белый', description: 'Пшеничный, 600г', price: 5000, unit: ProductUnit.PCS, quantity: 100 },
  { name: 'Хлеб чёрный', description: 'Ржаной, 500г', price: 4500, unit: ProductUnit.PCS, quantity: 80 },
  { name: 'Лепёшки', description: 'Узбекские, 250г', price: 3000, unit: ProductUnit.PCS, quantity: 120 },
  { name: 'Булочка сдобная', description: 'С маком, 100г', price: 2500, unit: ProductUnit.PCS, quantity: 90 },
  { name: 'Печенье овсяное', description: '500г', price: 12000, unit: ProductUnit.PCS, quantity: 35 },
  { name: 'Яблоки', description: 'Красные, 1кг', price: 10000, unit: ProductUnit.KG, quantity: 60 },
  { name: 'Бананы', description: 'Свежие, 1кг', price: 14000, unit: ProductUnit.KG, quantity: 45 },
  { name: 'Картофель', description: 'Молодой, 1кг', price: 5000, unit: ProductUnit.KG, quantity: 100 },
  { name: 'Помидоры', description: 'Свежие, 1кг', price: 12000, unit: ProductUnit.KG, quantity: 50 },
  { name: 'Огурцы', description: 'Свежие, 1кг', price: 8000, unit: ProductUnit.KG, quantity: 60 },
  { name: 'Лук репчатый', description: '1кг', price: 4000, unit: ProductUnit.KG, quantity: 80 },
  { name: 'Говядина', description: 'Мякоть, 1кг', price: 65000, unit: ProductUnit.KG, quantity: 20 },
  { name: 'Курица', description: 'Целая тушка, 1кг', price: 28000, unit: ProductUnit.KG, quantity: 30 },
  { name: 'Фарш мясной', description: 'Говяжий, 500г', price: 25000, unit: ProductUnit.PCS, quantity: 25 },
  { name: 'Колбаса варёная', description: 'Докторская, 400г', price: 18000, unit: ProductUnit.PCS, quantity: 30 },
  { name: 'Яйца куриные', description: 'Десяток, 10шт', price: 14000, unit: ProductUnit.BOX, quantity: 40 },
  { name: 'Масло подсолнечное', description: '1л', price: 16000, unit: ProductUnit.L, quantity: 35 },
  { name: 'Сахар', description: '1кг', price: 11000, unit: ProductUnit.KG, quantity: 50 },
  { name: 'Рис', description: 'Девзира, 1кг', price: 15000, unit: ProductUnit.KG, quantity: 40 },
  { name: 'Мука пшеничная', description: '1кг', price: 7000, unit: ProductUnit.KG, quantity: 45 },
]

const market2Products = [
  { name: 'Вода минеральная', description: 'Газированная, 0.5л', price: 3000, unit: ProductUnit.PCS, quantity: 200 },
  { name: 'Сок яблочный', description: '1л', price: 10000, unit: ProductUnit.L, quantity: 60 },
  { name: 'Кола', description: '0.5л', price: 7000, unit: ProductUnit.PCS, quantity: 150 },
  { name: 'Чай зелёный', description: 'Листовой, 100г', price: 12000, unit: ProductUnit.PCS, quantity: 30 },
  { name: 'Кофе растворимый', description: '100г', price: 25000, unit: ProductUnit.PCS, quantity: 20 },
  { name: 'Шоколад молочный', description: '90г', price: 15000, unit: ProductUnit.PCS, quantity: 40 },
  { name: 'Пирожное', description: 'Корзиночка, 1шт', price: 5000, unit: ProductUnit.PCS, quantity: 60 },
  { name: 'Зефир', description: 'Ванильный, 250г', price: 11000, unit: ProductUnit.PCS, quantity: 25 },
  { name: 'Мармелад', description: 'Фруктовый, 300г', price: 13000, unit: ProductUnit.PCS, quantity: 30 },
  { name: 'Вафли', description: 'С шоколадной начинкой, 200г', price: 9000, unit: ProductUnit.PCS, quantity: 35 },
  { name: 'Сёмга слабосолёная', description: '200г', price: 35000, unit: ProductUnit.PCS, quantity: 15 },
  { name: 'Креветки', description: 'Мороженые, 1кг', price: 55000, unit: ProductUnit.KG, quantity: 10 },
  { name: 'Мидии', description: 'В створах, 1кг', price: 40000, unit: ProductUnit.KG, quantity: 8 },
  { name: 'Рыба красная', description: 'Форель, 1кг', price: 70000, unit: ProductUnit.KG, quantity: 12 },
  { name: 'Кальмары', description: 'Мороженые, 500г', price: 22000, unit: ProductUnit.PCS, quantity: 15 },
  { name: 'Гречка', description: '1кг', price: 12000, unit: ProductUnit.KG, quantity: 35 },
  { name: 'Макароны', description: 'Спагетти, 400г', price: 6000, unit: ProductUnit.PCS, quantity: 50 },
  { name: 'Овсянка', description: 'Геркулес, 500г', price: 8000, unit: ProductUnit.PCS, quantity: 30 },
  { name: 'Рис круглозёрный', description: '1кг', price: 13000, unit: ProductUnit.KG, quantity: 40 },
  { name: 'Чечевица', description: 'Красная, 500г', price: 9000, unit: ProductUnit.PCS, quantity: 20 },
  { name: 'Горошек зелёный', description: 'Консервированный, 400г', price: 8000, unit: ProductUnit.PCS, quantity: 35 },
  { name: 'Тушёнка говяжья', description: 'Банка 350г', price: 22000, unit: ProductUnit.PCS, quantity: 25 },
  { name: 'Рыбные консервы', description: 'Сайра в масле, 250г', price: 15000, unit: ProductUnit.PCS, quantity: 30 },
  { name: 'Кукуруза консервированная', description: 'Банка 340г', price: 9000, unit: ProductUnit.PCS, quantity: 28 },
  { name: 'Огурцы маринованные', description: 'Банка 500г', price: 14000, unit: ProductUnit.PCS, quantity: 22 },
  { name: 'Томатная паста', description: '250г', price: 7000, unit: ProductUnit.PCS, quantity: 30 },
]

async function createAllProducts(marketId: string, categories: { id: string }[], productList: typeof market1Products) {
  const products: { id: string; name: string; price: number }[] = []
  for (let i = 0; i < categories.length; i++) {
    const chunk = productList.slice(i * 5, (i + 1) * 5)
    for (const p of chunk) {
      const product = await prisma.product.create({
        data: {
          name: p.name,
          description: p.description,
          price: p.price,
          unit: p.unit,
          quantity: p.quantity,
          marketId,
          categoryId: categories[i].id,
          lowStockThreshold: 5,
          image: await uploadImage(nextImage()),
        },
      })
      products.push({ id: product.id, name: product.name, price: p.price })
    }
  }
  return products
}

const debtorData1 = [
  { name: 'Салимов Азиз', phone: '+998901234567' },
  { name: 'Рахимова Гульноза', phone: '+998902345678' },
  { name: 'Умаров Бахтиёр', phone: '+998903456789' },
  { name: 'Каримова Зухра', phone: '+998904567890' },
  { name: 'Турсунов Фаррух', phone: '+998905678901' },
]

const debtorData2 = [
  { name: 'Азимова Наргиза', phone: '+998911234567' },
  { name: 'Собиров Джамшид', phone: '+998912345678' },
  { name: 'Исламова Мухаббат', phone: '+998913456789' },
  { name: 'Хакимов Шерзод', phone: '+998914567890' },
  { name: 'Усманова Лола', phone: '+998915678901' },
]

async function createDebtors(marketId: string, list: typeof debtorData1) {
  return Promise.all(
    list.map((d) => prisma.debtor.create({ data: { ...d, marketId } })),
  )
}

interface TxnItem {
  productId: string
  productName: string
  quantity: number
  price: number
  discount: number
  totalPrice: number
}

interface TxnDef {
  type: 'SALE' | 'DEBT' | 'REFUND'
  paymentType: 'CASH' | 'CARD' | 'CREDIT'
  status: 'PAID' | 'ACTIVE' | 'PARTIAL' | 'REFUNDED'
  createdById: string
  debtorId?: string
  items: TxnItem[]
}

async function createTransactions(
  marketId: string,
  products: { id: string; name: string; price: number }[],
  debtors: { id: string }[],
  sellers: { id: string }[],
  owner: { id: string },
) {
  const defs: TxnDef[] = [
    {
      type: 'SALE', paymentType: 'CASH', status: 'PAID',
      createdById: sellers[0].id,
      items: [
        { productId: products[0].id, productName: products[0].name, quantity: 2, price: products[0].price, discount: 0, totalPrice: products[0].price * 2 },
        { productId: products[1].id, productName: products[1].name, quantity: 1, price: products[1].price, discount: 500, totalPrice: products[1].price - 500 },
      ],
    },
    {
      type: 'DEBT', paymentType: 'CREDIT', status: 'ACTIVE',
      createdById: sellers[0].id, debtorId: debtors[0].id,
      items: [
        { productId: products[2].id, productName: products[2].name, quantity: 5, price: products[2].price, discount: 0, totalPrice: products[2].price * 5 },
      ],
    },
    {
      type: 'SALE', paymentType: 'CARD', status: 'PAID',
      createdById: sellers[1].id,
      items: [
        { productId: products[3].id, productName: products[3].name, quantity: 3, price: products[3].price, discount: 0, totalPrice: products[3].price * 3 },
        { productId: products[4].id, productName: products[4].name, quantity: 1, price: products[4].price, discount: 2000, totalPrice: products[4].price - 2000 },
        { productId: products[5].id, productName: products[5].name, quantity: 6, price: products[5].price, discount: 0, totalPrice: products[5].price * 6 },
      ],
    },
    {
      type: 'DEBT', paymentType: 'CREDIT', status: 'PARTIAL',
      createdById: sellers[1].id, debtorId: debtors[1].id,
      items: [
        { productId: products[6].id, productName: products[6].name, quantity: 4, price: products[6].price, discount: 0, totalPrice: products[6].price * 4 },
      ],
    },
    {
      type: 'SALE', paymentType: 'CASH', status: 'PAID',
      createdById: owner.id,
      items: [
        { productId: products[7].id, productName: products[7].name, quantity: 10, price: products[7].price, discount: 0, totalPrice: products[7].price * 10 },
      ],
    },
    {
      type: 'DEBT', paymentType: 'CREDIT', status: 'ACTIVE',
      createdById: sellers[0].id, debtorId: debtors[2].id,
      items: [
        { productId: products[8].id, productName: products[8].name, quantity: 8, price: products[8].price, discount: 0, totalPrice: products[8].price * 8 },
        { productId: products[9].id, productName: products[9].name, quantity: 3, price: products[9].price, discount: 0, totalPrice: products[9].price * 3 },
      ],
    },
    {
      type: 'SALE', paymentType: 'CASH', status: 'PAID',
      createdById: sellers[1].id,
      items: [
        { productId: products[10].id, productName: products[10].name, quantity: 5, price: products[10].price, discount: 1000, totalPrice: products[10].price * 5 - 1000 },
      ],
    },
    {
      type: 'SALE', paymentType: 'CARD', status: 'PAID',
      createdById: sellers[0].id,
      items: [
        { productId: products[11].id, productName: products[11].name, quantity: 2, price: products[11].price, discount: 0, totalPrice: products[11].price * 2 },
        { productId: products[12].id, productName: products[12].name, quantity: 1, price: products[12].price, discount: 1500, totalPrice: products[12].price - 1500 },
      ],
    },
    {
      type: 'DEBT', paymentType: 'CREDIT', status: 'PARTIAL',
      createdById: sellers[1].id, debtorId: debtors[3].id,
      items: [
        { productId: products[13].id, productName: products[13].name, quantity: 12, price: products[13].price, discount: 0, totalPrice: products[13].price * 12 },
      ],
    },
    {
      type: 'SALE', paymentType: 'CASH', status: 'PAID',
      createdById: owner.id,
      items: [
        { productId: products[14].id, productName: products[14].name, quantity: 1, price: products[14].price, discount: 0, totalPrice: products[14].price },
        { productId: products[15].id, productName: products[15].name, quantity: 1, price: products[15].price, discount: 0, totalPrice: products[15].price },
        { productId: products[16].id, productName: products[16].name, quantity: 2, price: products[16].price, discount: 0, totalPrice: products[16].price * 2 },
      ],
    },
  ]

  const transactions: { id: string; createdById: string; status: string; totalAmount: number; remainingAmount: number }[] = []
  for (const def of defs) {
    const totalFromItems = def.items.reduce((sum, i) => sum + i.totalPrice, 0)
    const transaction = await prisma.transaction.create({
      data: {
        marketId,
        createdById: def.createdById,
        debtorId: def.debtorId ?? null,
        type: def.type,
        paymentType: def.paymentType,
        totalAmount: totalFromItems,
        discountAmount: def.items.reduce((s, i) => s + i.discount, 0),
        remainingAmount: def.status === 'ACTIVE' ? totalFromItems : def.status === 'PARTIAL' ? totalFromItems / 2 : 0,
        status: def.status,
        items: { createMany: { data: def.items } },
      },
    })
    transactions.push(transaction)
  }
  return transactions
}

async function createPayments(transactions: { id: string; status: string; totalAmount: number; remainingAmount: number; createdById: string }[], sellers: { id: string }[]) {
  for (const tx of transactions) {
    if (tx.status === 'ACTIVE') continue
    const paidAmount = tx.totalAmount - tx.remainingAmount
    await prisma.payment.create({
      data: {
        transactionId: tx.id,
        amount: paidAmount,
        createdById: tx.status === 'PARTIAL' ? sellers[0].id : tx.createdById,
      },
    })
  }
}

async function main() {
  console.log('Очистка таблиц...')
  await clearTables()

  console.log('Создание администратора...')
  const admin = await createAdmin()
  console.log(`  ✓ Администратор: ${admin.email}`)

  console.log('Создание Рынка Центральный...')
  const m1 = await createMarket1()
  console.log(`  ✓ Рынок: ${m1.market.id}`)
  console.log('Создание Рынка Восточный...')
  const m2 = await createMarket2()
  console.log(`  ✓ Рынок: ${m2.market.id}`)

  console.log('Создание категорий...')
  const cats1 = await createCategories(m1.market.id, categoryData1)
  const cats2 = await createCategories(m2.market.id, categoryData2)
  console.log(`  ✓ Категории: ${cats1.length + cats2.length}`)

  console.log('Создание товаров...')
  const products1 = await createAllProducts(m1.market.id, cats1, market1Products)
  const products2 = await createAllProducts(m2.market.id, cats2, market2Products)
  console.log(`  ✓ Товары: ${products1.length + products2.length}`)

  console.log('Создание должников...')
  const debtors1 = await createDebtors(m1.market.id, debtorData1)
  const debtors2 = await createDebtors(m2.market.id, debtorData2)
  console.log(`  ✓ Должники: ${debtors1.length + debtors2.length}`)

  console.log('Создание транзакций...')
  const transactions1 = await createTransactions(m1.market.id, products1, debtors1, m1.sellers, m1.owner)
  const transactions2 = await createTransactions(m2.market.id, products2, debtors2, m2.sellers, m2.owner)
  console.log(`  ✓ Транзакции: ${transactions1.length + transactions2.length}`)

  console.log('Создание платежей...')
  await createPayments(transactions1, m1.sellers)
  await createPayments(transactions2, m2.sellers)
  console.log('  ✓ Платежи созданы')

  console.log('\n✅ Сидирование завершено!')
  console.log(`\nУчётные данные:`)
  console.log(`  Админ: admin@tradecrm.com / 12345678Aa`)
  console.log(`  Владельцы: alisher@tradecrm.com, dilnoza@tradecrm.com / 12345678Aa`)
  console.log(`  Продавцы: bakhtiyar@tradecrm.com, madina@tradecrm.com, jasur@tradecrm.com, nigora@tradecrm.com / 12345678Aa`)
}

main()
  .catch((e) => {
    console.error('❌ Ошибка:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
