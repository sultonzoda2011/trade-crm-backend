import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcrypt'
import 'dotenv/config'
import {
	CATEGORY_DATA_1,
	CATEGORY_DATA_2,
	DEBTOR_DATA_1,
	DEBTOR_DATA_2,
	MARKET_1_PRODUCTS,
	MARKET_1_SPEC,
	MARKET_2_PRODUCTS,
	MARKET_2_SPEC,
	MarketSeedSpec
} from './seed-data'

const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! })
})

async function clearTables() {
	await prisma.sellerCredit.deleteMany()
	await prisma.payment.deleteMany()
	await prisma.transactionItem.deleteMany()
	await prisma.transaction.deleteMany()
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

async function createMarketWithStaff(spec: MarketSeedSpec): Promise<MarketUsers> {
	const password = await hash('12345678Aa', 10)
	const owner = await prisma.user.create({
		data: {
			name: spec.owner.name,
			email: spec.owner.email,
			password,
			role: 'OWNER',
			image: null
		}
	})
	const market = await prisma.market.create({
		data: {
			name: spec.name,
			address: spec.address,
			ownerId: owner.id,
			image: null
		}
	})
	await prisma.user.update({
		where: { id: owner.id },
		data: { marketId: market.id }
	})
	const sellers = await Promise.all(
		spec.sellers.map(s =>
			prisma.user.create({
				data: {
					name: s.name,
					email: s.email,
					password,
					role: 'SELLER',
					marketId: market.id,
					image: null
				}
			})
		)
	)
	return { market, owner, sellers }
}

async function createCategories(
	marketId: string,
	list: typeof CATEGORY_DATA_1
) {
	return Promise.all(
		list.map(c =>
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

async function createAllProducts(
	marketId: string,
	categories: { id: string }[],
	productList: typeof MARKET_1_PRODUCTS
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

async function createDebtors(marketId: string, list: typeof DEBTOR_DATA_1) {
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
	markup: number
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
	discount = 0,
	markup = 0
): TxnItem {
	return {
		productId: product.id,
		productName: product.name,
		quantity,
		price: product.price,
		discount,
		markup,
		totalPrice: product.price * quantity - discount + markup
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

	// Обычные продажи — основной поток, разного размера чека. Часть строк
	// содержит markup (продавец накинул сверху цены), часть — discount,
	// часть вообще без изменений цены, чтобы данные выглядели естественно.
	for (let i = 0; i < 24; i++) {
		const seller = i % 3 === 0 ? owner : sellers[i % sellers.length]
		const itemCount = 1 + (i % 3)
		const items: TxnItem[] = []
		for (let k = 0; k < itemCount; k++) {
			const hasDiscount = (i + k) % 5 === 0
			const hasMarkup = !hasDiscount && (i + k) % 4 === 0
			items.push(
				line(
					p(cursor + k),
					1 + ((i + k) % 4),
					hasDiscount ? 1000 : 0,
					hasMarkup ? 500 + ((i + k) % 5) * 500 : 0
				)
			)
		}
		cursor += itemCount
		defs.push({
			type: 'SALE',
			paymentType: payers[i % payers.length],
			status: 'PAID',
			createdById: seller.id,
			daysAgo: i * 2 + (i % 6) / 6,
			items
		})
	}

	// Долги: часть ещё не тронута (ACTIVE), часть частично погашена (PARTIAL).
	debtors.forEach((debtor, i) => {
		const seller = sellers[i % sellers.length]
		const items = [
			line(p(cursor), 2 + i, 0, i % 2 === 0 ? 1000 : 0),
			line(p(cursor + 1), 1, 0)
		]
		cursor += 2
		defs.push({
			type: 'DEBT',
			paymentType: 'CREDIT',
			status: i % 2 === 0 ? 'ACTIVE' : 'PARTIAL',
			createdById: seller.id,
			debtorId: debtor.id,
			daysAgo: 3 + i * 4 + (i % 3) / 4,
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
			markup: number
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
				markupAmount: def.items.reduce((s, i) => s + i.markup, 0),
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
 * Баланс продавца = Σ markup по его транзакциям (SALE/DEBT, не REFUND).
 * Для сида выдаём каждому продавцу примерно половину накопленного —
 * так на странице продавца сразу видно и остаток к выдаче, и историю
 * уже выданных сумм, а не пустой баланс или полностью закрытый.
 */
async function createSellerCredits(
	transactions: {
		createdById: string
		type: string
		items: { markup: number }[]
		createdAt: Date
	}[],
	sellers: { id: string }[],
	owner: { id: string }
) {
	for (const seller of sellers) {
		const earned = transactions
			.filter(t => t.createdById === seller.id && t.type !== 'REFUND')
			.reduce(
				(sum, t) => sum + t.items.reduce((s, i) => s + i.markup, 0),
				0
			)
		if (earned <= 0) continue

		const payoutAmount = Math.round(earned * 0.5)
		if (payoutAmount <= 0) continue

		await prisma.sellerCredit.create({
			data: {
				sellerId: seller.id,
				amount: payoutAmount,
				note: 'Частичная выплата накопленной надбавки',
				createdById: owner.id,
				createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
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
			markup: number
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
			markupAmount: full.items.reduce((s, i) => s + i.markup, 0),
			remainingAmount: 0,
			status: 'PAID',
			items: {
				create: full.items.map(i => ({
					productId: i.productId,
					productName: i.productName,
					quantity: i.quantity,
					price: i.price,
					discount: i.discount,
					markup: i.markup,
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
		markup: Math.round((partialItem.markup / partialItem.quantity) * refundQty),
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
			markupAmount: refundLine.markup,
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
	const m1 = await createMarketWithStaff(MARKET_1_SPEC)
	console.log(`  ✓ Рынок: ${m1.market.id}`)
	console.log('Создание Рынка Восточный...')
	const m2 = await createMarketWithStaff(MARKET_2_SPEC)
	console.log(`  ✓ Рынок: ${m2.market.id}`)

	console.log('Создание категорий...')
	const cats1 = await createCategories(m1.market.id, CATEGORY_DATA_1)
	const cats2 = await createCategories(m2.market.id, CATEGORY_DATA_2)
	console.log(`  ✓ Категории: ${cats1.length + cats2.length}`)

	console.log('Создание товаров...')
	const products1 = await createAllProducts(
		m1.market.id,
		cats1,
		MARKET_1_PRODUCTS
	)
	const products2 = await createAllProducts(
		m2.market.id,
		cats2,
		MARKET_2_PRODUCTS
	)
	console.log(`  ✓ Товары: ${products1.length + products2.length}`)

	console.log('Создание должников...')
	const debtors1 = await createDebtors(m1.market.id, DEBTOR_DATA_1)
	const debtors2 = await createDebtors(m2.market.id, DEBTOR_DATA_2)
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

	console.log('Начисление и частичная выплата надбавок продавцам...')
	await createSellerCredits(transactions1, m1.sellers, m1.owner)
	await createSellerCredits(transactions2, m2.sellers, m2.owner)
	console.log('  ✓ Надбавки выданы (частично)')

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
