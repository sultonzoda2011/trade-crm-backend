import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, ProductUnit } from '@prisma/client'
import { hash } from 'bcrypt'
import 'dotenv/config'

const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! })
})

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
			image: null
		}
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
		data: {
			name: 'Алишер Каримов',
			email: 'alisher@tradecrm.com',
			password,
			role: 'OWNER',
			image: null
		}
	})
	const market = await prisma.market.create({
		data: {
			name: 'Рынок Центральный',
			address: 'ул. Ленина, 15, г. Ташкент',
			ownerId: owner.id,
			image: null
		}
	})
	await prisma.user.update({
		where: { id: owner.id },
		data: { marketId: market.id }
	})
	const s1 = await prisma.user.create({
		data: {
			name: 'Бахтияр Рахимов',
			email: 'bakhtiyar@tradecrm.com',
			password,
			role: 'SELLER',
			marketId: market.id,
			image: null
		}
	})
	const s2 = await prisma.user.create({
		data: {
			name: 'Мадина Юсупова',
			email: 'madina@tradecrm.com',
			password,
			role: 'SELLER',
			marketId: market.id,
			image: null
		}
	})
	return { market, owner, sellers: [s1, s2] }
}

async function createMarket2(): Promise<MarketUsers> {
	const password = await hash('12345678Aa', 10)
	const owner = await prisma.user.create({
		data: {
			name: 'Дилноза Азимова',
			email: 'dilnoza@tradecrm.com',
			password,
			role: 'OWNER',
			image: null
		}
	})
	const market = await prisma.market.create({
		data: {
			name: 'Рынок Восточный',
			address: 'ул. Амира Темура, 42, г. Ташкент',
			ownerId: owner.id,
			image: null
		}
	})
	await prisma.user.update({
		where: { id: owner.id },
		data: { marketId: market.id }
	})
	const s1 = await prisma.user.create({
		data: {
			name: 'Жасур Ахмедов',
			email: 'jasur@tradecrm.com',
			password,
			role: 'SELLER',
			marketId: market.id,
			image: null
		}
	})
	const s2 = await prisma.user.create({
		data: {
			name: 'Нигора Камилова',
			email: 'nigora@tradecrm.com',
			password,
			role: 'SELLER',
			marketId: market.id,
			image: null
		}
	})
	return { market, owner, sellers: [s1, s2] }
}

const categoryData1 = [
	{
		name: 'Молочные продукты',
		description: 'Свежие молоко, йогурты, сыры и творог от местных ферм'
	},
	{
		name: 'Хлебобулочные изделия',
		description: 'Свежая выпечка, хлеб и лепёшки каждый день'
	},
	{
		name: 'Овощи и фрукты',
		description: 'Сезонные овощи и фрукты напрямую с базара'
	},
	{
		name: 'Мясо и птица',
		description: 'Свежее мясо, птица и мясные полуфабрикаты'
	},
	{
		name: 'Бакалея',
		description: 'Сахар, мука, масло и другие товары повседневного спроса'
	}
]

async function createCategories(marketId: string, list: typeof categoryData1) {
	return Promise.all(
		list.map(async c =>
			prisma.category.create({
				data: {
					name: c.name,
					description: c.description,
					marketId,
					image: null
				}
			})
		)
	)
}

const categoryData2 = [
	{
		name: 'Напитки',
		description: 'Вода, соки, газированные и горячие напитки'
	},
	{
		name: 'Кондитерские изделия',
		description: 'Шоколад, конфеты, зефир и другие сладости'
	},
	{
		name: 'Морепродукты',
		description: 'Свежая и мороженая рыба, креветки и мидии'
	},
	{
		name: 'Крупы и макароны',
		description: 'Крупы, макаронные изделия и бобовые'
	},
	{ name: 'Консервация', description: 'Консервы, маринады и томатная паста' }
]

const market1Products = [
	{
		name: 'Молоко свежее',
		description: 'Жирность 3.2%, 1л',
		price: 8000,
		unit: ProductUnit.L,
		quantity: 50
	},
	{
		name: 'Кефир',
		description: 'Жирность 2.5%, 1л',
		price: 7000,
		unit: ProductUnit.L,
		quantity: 40
	},
	{
		name: 'Сметана',
		description: 'Жирность 20%, 400г',
		price: 12000,
		unit: ProductUnit.PCS,
		quantity: 30
	},
	{
		name: 'Творог',
		description: 'Жирность 5%, 250г',
		price: 15000,
		unit: ProductUnit.PCS,
		quantity: 25
	},
	{
		name: 'Сыр твёрдый',
		description: 'Голландский, 1кг',
		price: 85000,
		unit: ProductUnit.KG,
		quantity: 10
	},
	{
		name: 'Йогурт питьевой',
		description: 'Клубничный, 0.5л',
		price: 6000,
		unit: ProductUnit.PCS,
		quantity: 60
	},
	{
		name: 'Хлеб белый',
		description: 'Пшеничный, 600г',
		price: 5000,
		unit: ProductUnit.PCS,
		quantity: 100
	},
	{
		name: 'Хлеб чёрный',
		description: 'Ржаной, 500г',
		price: 4500,
		unit: ProductUnit.PCS,
		quantity: 80
	},
	{
		name: 'Лепёшки',
		description: 'Узбекские, 250г',
		price: 3000,
		unit: ProductUnit.PCS,
		quantity: 120
	},
	{
		name: 'Булочка сдобная',
		description: 'С маком, 100г',
		price: 2500,
		unit: ProductUnit.PCS,
		quantity: 90
	},
	{
		name: 'Печенье овсяное',
		description: '500г',
		price: 12000,
		unit: ProductUnit.PCS,
		quantity: 35
	},
	{
		name: 'Яблоки',
		description: 'Красные, 1кг',
		price: 10000,
		unit: ProductUnit.KG,
		quantity: 60
	},
	{
		name: 'Бананы',
		description: 'Свежие, 1кг',
		price: 14000,
		unit: ProductUnit.KG,
		quantity: 45
	},
	{
		name: 'Картофель',
		description: 'Молодой, 1кг',
		price: 5000,
		unit: ProductUnit.KG,
		quantity: 100
	},
	{
		name: 'Помидоры',
		description: 'Свежие, 1кг',
		price: 12000,
		unit: ProductUnit.KG,
		quantity: 50
	},
	{
		name: 'Огурцы',
		description: 'Свежие, 1кг',
		price: 8000,
		unit: ProductUnit.KG,
		quantity: 60
	},
	{
		name: 'Лук репчатый',
		description: '1кг',
		price: 4000,
		unit: ProductUnit.KG,
		quantity: 80
	},
	{
		name: 'Говядина',
		description: 'Мякоть, 1кг',
		price: 65000,
		unit: ProductUnit.KG,
		quantity: 20
	},
	{
		name: 'Курица',
		description: 'Целая тушка, 1кг',
		price: 28000,
		unit: ProductUnit.KG,
		quantity: 30
	},
	{
		name: 'Фарш мясной',
		description: 'Говяжий, 500г',
		price: 25000,
		unit: ProductUnit.PCS,
		quantity: 25
	},
	{
		name: 'Колбаса варёная',
		description: 'Докторская, 400г',
		price: 18000,
		unit: ProductUnit.PCS,
		quantity: 30
	},
	{
		name: 'Яйца куриные',
		description: 'Десяток, 10шт',
		price: 14000,
		unit: ProductUnit.BOX,
		quantity: 40
	},
	{
		name: 'Масло подсолнечное',
		description: '1л',
		price: 16000,
		unit: ProductUnit.L,
		quantity: 35
	},
	{
		name: 'Сахар',
		description: '1кг',
		price: 11000,
		unit: ProductUnit.KG,
		quantity: 50
	},
	{
		name: 'Рис',
		description: 'Девзира, 1кг',
		price: 15000,
		unit: ProductUnit.KG,
		quantity: 40
	},
	{
		name: 'Мука пшеничная',
		description: '1кг',
		price: 7000,
		unit: ProductUnit.KG,
		quantity: 3
	}
]

const market2Products = [
	{
		name: 'Вода минеральная',
		description: 'Газированная, 0.5л',
		price: 3000,
		unit: ProductUnit.PCS,
		quantity: 200
	},
	{
		name: 'Сок яблочный',
		description: '1л',
		price: 10000,
		unit: ProductUnit.L,
		quantity: 60
	},
	{
		name: 'Кола',
		description: '0.5л',
		price: 7000,
		unit: ProductUnit.PCS,
		quantity: 150
	},
	{
		name: 'Чай зелёный',
		description: 'Листовой, 100г',
		price: 12000,
		unit: ProductUnit.PCS,
		quantity: 30
	},
	{
		name: 'Кофе растворимый',
		description: '100г',
		price: 25000,
		unit: ProductUnit.PCS,
		quantity: 20
	},
	{
		name: 'Шоколад молочный',
		description: '90г',
		price: 15000,
		unit: ProductUnit.PCS,
		quantity: 40
	},
	{
		name: 'Пирожное',
		description: 'Корзиночка, 1шт',
		price: 5000,
		unit: ProductUnit.PCS,
		quantity: 60
	},
	{
		name: 'Зефир',
		description: 'Ванильный, 250г',
		price: 11000,
		unit: ProductUnit.PCS,
		quantity: 25
	},
	{
		name: 'Мармелад',
		description: 'Фруктовый, 300г',
		price: 13000,
		unit: ProductUnit.PCS,
		quantity: 30
	},
	{
		name: 'Вафли',
		description: 'С шоколадной начинкой, 200г',
		price: 9000,
		unit: ProductUnit.PCS,
		quantity: 35
	},
	{
		name: 'Сёмга слабосолёная',
		description: '200г',
		price: 35000,
		unit: ProductUnit.PCS,
		quantity: 15
	},
	{
		name: 'Креветки',
		description: 'Мороженые, 1кг',
		price: 55000,
		unit: ProductUnit.KG,
		quantity: 10
	},
	{
		name: 'Мидии',
		description: 'В створах, 1кг',
		price: 40000,
		unit: ProductUnit.KG,
		quantity: 8
	},
	{
		name: 'Рыба красная',
		description: 'Форель, 1кг',
		price: 70000,
		unit: ProductUnit.KG,
		quantity: 12
	},
	{
		name: 'Кальмары',
		description: 'Мороженые, 500г',
		price: 22000,
		unit: ProductUnit.PCS,
		quantity: 15
	},
	{
		name: 'Гречка',
		description: '1кг',
		price: 12000,
		unit: ProductUnit.KG,
		quantity: 35
	},
	{
		name: 'Макароны',
		description: 'Спагетти, 400г',
		price: 6000,
		unit: ProductUnit.PCS,
		quantity: 50
	},
	{
		name: 'Овсянка',
		description: 'Геркулес, 500г',
		price: 8000,
		unit: ProductUnit.PCS,
		quantity: 30
	},
	{
		name: 'Рис круглозёрный',
		description: '1кг',
		price: 13000,
		unit: ProductUnit.KG,
		quantity: 40
	},
	{
		name: 'Чечевица',
		description: 'Красная, 500г',
		price: 9000,
		unit: ProductUnit.PCS,
		quantity: 20
	},
	{
		name: 'Горошек зелёный',
		description: 'Консервированный, 400г',
		price: 8000,
		unit: ProductUnit.PCS,
		quantity: 35
	},
	{
		name: 'Тушёнка говяжья',
		description: 'Банка 350г',
		price: 22000,
		unit: ProductUnit.PCS,
		quantity: 25
	},
	{
		name: 'Рыбные консервы',
		description: 'Сайра в масле, 250г',
		price: 15000,
		unit: ProductUnit.PCS,
		quantity: 30
	},
	{
		name: 'Кукуруза консервированная',
		description: 'Банка 340г',
		price: 9000,
		unit: ProductUnit.PCS,
		quantity: 28
	},
	{
		name: 'Огурцы маринованные',
		description: 'Банка 500г',
		price: 14000,
		unit: ProductUnit.PCS,
		quantity: 22
	},
	{
		name: 'Томатная паста',
		description: '250г',
		price: 7000,
		unit: ProductUnit.PCS,
		quantity: 0
	}
]

async function createAllProducts(
	marketId: string,
	categories: { id: string }[],
	productList: typeof market1Products
) {
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
					image: null
				}
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
	{ name: 'Турсунов Фаррух', phone: '+998905678901' }
]

const debtorData2 = [
	{ name: 'Азимова Наргиза', phone: '+998911234567' },
	{ name: 'Собиров Джамшид', phone: '+998912345678' },
	{ name: 'Исламова Мухаббат', phone: '+998913456789' },
	{ name: 'Хакимов Шерзод', phone: '+998914567890' },
	{ name: 'Усманова Лола', phone: '+998915678901' }
]

async function createDebtors(marketId: string, list: typeof debtorData1) {
	return Promise.all(
		list.map(d => prisma.debtor.create({ data: { ...d, marketId } }))
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
	type: 'SALE' | 'DEBT'
	paymentType: 'CASH' | 'CARD' | 'CREDIT'
	status: 'PAID' | 'ACTIVE' | 'PARTIAL'
	createdById: string
	debtorId?: string
	daysAgo: number
	items: TxnItem[]
}

function line(
	product: { id: string; name: string; price: number },
	quantity: number,
	discount = 0
): TxnItem {
	return {
		productId: product.id,
		productName: product.name,
		quantity,
		price: product.price,
		discount,
		totalPrice: product.price * quantity - discount
	}
}

/**
 * Транзакции размазаны по последним 60 дням (не все созданы «сегодня»),
 * иначе графики дашборда (тренд выручки по дням/неделям) показывают одну
 * точку и выглядят пустыми. daysAgo=0 — сегодня, daysAgo=59 — почти два
 * месяца назад.
 */
function buildTxnDefs(
	products: { id: string; name: string; price: number }[],
	debtors: { id: string }[],
	sellers: { id: string }[],
	owner: { id: string }
): TxnDef[] {
	const p = (i: number) => products[i % products.length]
	const defs: TxnDef[] = []

	const payers: ('CASH' | 'CARD')[] = ['CASH', 'CARD']
	let cursor = 0

	// Обычные продажи — основной поток, разного размера чека.
	for (let i = 0; i < 24; i++) {
		const seller = i % 3 === 0 ? owner : sellers[i % sellers.length]
		const itemCount = 1 + (i % 3)
		const items: TxnItem[] = []
		for (let k = 0; k < itemCount; k++) {
			items.push(line(p(cursor + k), 1 + ((i + k) % 4), i % 5 === 0 ? 1000 : 0))
		}
		cursor += itemCount
		defs.push({
			type: 'SALE',
			paymentType: payers[i % payers.length],
			status: 'PAID',
			createdById: seller.id,
			daysAgo: i * 2, // раз в два дня — 24 продажи покрывают ~48 дней
			items
		})
	}

	// Долги: часть ещё не тронута (ACTIVE), часть частично погашена (PARTIAL).
	debtors.forEach((debtor, i) => {
		const seller = sellers[i % sellers.length]
		const items = [line(p(cursor), 2 + i, 0), line(p(cursor + 1), 1, 0)]
		cursor += 2
		defs.push({
			type: 'DEBT',
			paymentType: 'CREDIT',
			status: i % 2 === 0 ? 'ACTIVE' : 'PARTIAL',
			createdById: seller.id,
			debtorId: debtor.id,
			daysAgo: 3 + i * 4,
			items
		})
	})

	return defs
}

async function createTransactions(
	marketId: string,
	products: { id: string; name: string; price: number }[],
	debtors: { id: string }[],
	sellers: { id: string }[],
	owner: { id: string }
) {
	const defs = buildTxnDefs(products, debtors, sellers, owner)

	const transactions: {
		id: string
		createdById: string
		status: string
		type: string
		paymentType: string
		debtorId: string | null
		totalAmount: number
		remainingAmount: number
		createdAt: Date
		items: {
			id: string
			productId: string
			productName: string
			quantity: number
			price: number
			discount: number
			totalPrice: number
		}[]
	}[] = []

	for (const def of defs) {
		const totalFromItems = def.items.reduce((sum, i) => sum + i.totalPrice, 0)
		const createdAt = new Date(Date.now() - def.daysAgo * 24 * 60 * 60 * 1000)
		const transaction = await prisma.transaction.create({
			data: {
				marketId,
				createdById: def.createdById,
				debtorId: def.debtorId ?? null,
				type: def.type,
				paymentType: def.paymentType,
				totalAmount: totalFromItems,
				discountAmount: def.items.reduce((s, i) => s + i.discount, 0),
				remainingAmount:
					def.status === 'ACTIVE'
						? totalFromItems
						: def.status === 'PARTIAL'
							? Math.round(totalFromItems / 2)
							: 0,
				status: def.status,
				createdAt,
				items: { createMany: { data: def.items } }
			},
			include: { items: true }
		})
		transactions.push({ ...transaction, createdAt })
	}
	return transactions
}

async function createPayments(
	transactions: {
		id: string
		status: string
		totalAmount: number
		remainingAmount: number
		createdById: string
		createdAt: Date
	}[],
	sellers: { id: string }[]
) {
	for (const tx of transactions) {
		if (tx.status === 'ACTIVE') continue
		const paidAmount = tx.totalAmount - tx.remainingAmount
		await prisma.payment.create({
			data: {
				transactionId: tx.id,
				amount: paidAmount,
				createdById: tx.status === 'PARTIAL' ? sellers[0].id : tx.createdById,
				createdAt: tx.createdAt
			}
		})
	}
}

/**
 * Пара честных возвратов поверх уже созданных PAID-продаж — без них
 * страница возврата и аналитика (refundedRevenue, PARTIALLY_REFUNDED)
 * в дашборде всегда были бы пустыми. Логика зеркалит
 * TransactionsService.refund(): двигает refundedQuantity, возвращает
 * товар на склад, создаёт REFUND-транзакцию и проставляет статус
 * оригиналу (REFUNDED, если списано всё, иначе PARTIALLY_REFUNDED).
 */
async function createRefunds(
	marketId: string,
	transactions: {
		id: string
		type: string
		status: string
		debtorId?: string | null
		paymentType: string
		items: {
			id: string
			productId: string
			productName: string
			quantity: number
			price: number
			discount: number
			totalPrice: number
		}[]
	}[],
	owner: { id: string }
) {
	const paidSales = transactions.filter(
		t => t.type === 'SALE' && t.status === 'PAID'
	)
	if (paidSales.length < 2) return

	// 1. Полный возврат: все строки первой продажи целиком.
	const full = paidSales[0]
	for (const item of full.items) {
		await prisma.transactionItem.update({
			where: { id: item.id },
			data: { refundedQuantity: item.quantity }
		})
		await prisma.product.update({
			where: { id: item.productId },
			data: { quantity: { increment: item.quantity } }
		})
	}
	await prisma.transaction.create({
		data: {
			marketId,
			createdById: owner.id,
			debtorId: full.debtorId ?? null,
			refundOfId: full.id,
			type: 'REFUND',
			paymentType: full.paymentType as 'CASH' | 'CARD' | 'CREDIT',
			totalAmount: full.items.reduce((s, i) => s + i.totalPrice, 0),
			discountAmount: full.items.reduce((s, i) => s + i.discount, 0),
			remainingAmount: 0,
			status: 'PAID',
			items: {
				create: full.items.map(i => ({
					productId: i.productId,
					productName: i.productName,
					quantity: i.quantity,
					price: i.price,
					discount: i.discount,
					totalPrice: i.totalPrice,
					refundOfItemId: i.id
				}))
			}
		}
	})
	await prisma.transaction.update({
		where: { id: full.id },
		data: { status: 'REFUNDED' }
	})

	// 2. Частичный возврат: только половина первой строки второй продажи.
	const partial = paidSales[1]
	const partialItem = partial.items[0]
	const refundQty = Math.max(1, Math.floor(partialItem.quantity / 2))
	const unitNet = partialItem.totalPrice / partialItem.quantity
	const refundLine = {
		productId: partialItem.productId,
		productName: partialItem.productName,
		quantity: refundQty,
		price: partialItem.price,
		discount: Math.round(
			(partialItem.discount / partialItem.quantity) * refundQty
		),
		totalPrice: Math.round(unitNet * refundQty)
	}
	await prisma.transactionItem.update({
		where: { id: partialItem.id },
		data: { refundedQuantity: refundQty }
	})
	await prisma.product.update({
		where: { id: partialItem.productId },
		data: { quantity: { increment: refundQty } }
	})
	await prisma.transaction.create({
		data: {
			marketId,
			createdById: owner.id,
			debtorId: partial.debtorId ?? null,
			refundOfId: partial.id,
			type: 'REFUND',
			paymentType: partial.paymentType as 'CASH' | 'CARD' | 'CREDIT',
			totalAmount: refundLine.totalPrice,
			discountAmount: refundLine.discount,
			remainingAmount: 0,
			status: 'PAID',
			items: { create: [{ ...refundLine, refundOfItemId: partialItem.id }] }
		}
	})
	await prisma.transaction.update({
		where: { id: partial.id },
		data: { status: 'PARTIALLY_REFUNDED' }
	})
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
	const products1 = await createAllProducts(
		m1.market.id,
		cats1,
		market1Products
	)
	const products2 = await createAllProducts(
		m2.market.id,
		cats2,
		market2Products
	)
	console.log(`  ✓ Товары: ${products1.length + products2.length}`)

	console.log('Создание должников...')
	const debtors1 = await createDebtors(m1.market.id, debtorData1)
	const debtors2 = await createDebtors(m2.market.id, debtorData2)
	console.log(`  ✓ Должники: ${debtors1.length + debtors2.length}`)

	console.log('Создание транзакций (за последние ~60 дней)...')
	const transactions1 = await createTransactions(
		m1.market.id,
		products1,
		debtors1,
		m1.sellers,
		m1.owner
	)
	const transactions2 = await createTransactions(
		m2.market.id,
		products2,
		debtors2,
		m2.sellers,
		m2.owner
	)
	console.log(`  ✓ Транзакции: ${transactions1.length + transactions2.length}`)

	console.log('Создание платежей...')
	await createPayments(transactions1, m1.sellers)
	await createPayments(transactions2, m2.sellers)
	console.log('  ✓ Платежи созданы')

	console.log('Создание возвратов (полный + частичный на рынок)...')
	await createRefunds(m1.market.id, transactions1, m1.owner)
	await createRefunds(m2.market.id, transactions2, m2.owner)
	console.log('  ✓ Возвраты созданы')

	console.log('\n✅ Сидирование завершено!')
	console.log(`\nУчётные данные:`)
	console.log(`  Админ: admin@tradecrm.com / 12345678Aa`)
	console.log(
		`  Владельцы: alisher@tradecrm.com, dilnoza@tradecrm.com / 12345678Aa`
	)
	console.log(
		`  Продавцы: bakhtiyar@tradecrm.com, madina@tradecrm.com, jasur@tradecrm.com, nigora@tradecrm.com / 12345678Aa`
	)
}

main()
	.catch(e => {
		console.error('❌ Ошибка:', e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
