import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcrypt'
import 'dotenv/config'
import {
	CATEGORY_DATA_1,
	CATEGORY_DATA_2,
	DEBTOR_DATA_1,
	DEBTOR_DATA_2,
	DebtorSeed,
	MARKET_1_PRODUCTS,
	MARKET_1_SPEC,
	MARKET_2_PRODUCTS,
	MARKET_2_SPEC,
	MarketSeedSpec
} from './seed-data'

const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! })
})

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const NOW = Date.now()

/** Момент в прошлом: «N дней и M минут назад». */
const ago = (days: number, minutes = 0) =>
	new Date(NOW - days * DAY - minutes * MINUTE)

const round2 = (n: number) => Math.round(n * 100) / 100

type Seller = { id: string; name: string }
type Owner = { id: string }

interface SeedProduct {
	id: string
	name: string
	price: number
	costPrice: number | null
	initialQuantity: number
}

interface Line {
	productId: string
	productName: string
	quantity: number
	price: number
	costPrice: number | null
	discount: number
	markup: number
	totalPrice: number
}

/** Товар, который намеренно не продаётся: «мёртвый» остаток для аналитики. */
const DEAD_STOCK_INDEX = 10
/** Товары без закупочной цены: показывают, что costPrice необязателен. */
const NO_COST_INDEXES = [7, 19]

async function clearTables() {
	await prisma.sellerCredit.deleteMany()
	await prisma.payment.deleteMany()
	await prisma.transactionItem.deleteMany()
	await prisma.transaction.deleteMany()
	await prisma.product.deleteMany()
	await prisma.category.deleteMany()
	await prisma.debtor.deleteMany()
	await prisma.idempotencyKey.deleteMany()
	await prisma.throttleBucket.deleteMany()
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
	owner: Owner
	sellers: Seller[]
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
	const sellers: Seller[] = []
	for (const s of spec.sellers) {
		sellers.push(
			await prisma.user.create({
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
	}
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

/**
 * Закупочная цена — 55–78% от цены продажи (маржа разная у разных товаров).
 * У части товаров её нет вообще: поле необязательное, и интерфейс обязан
 * нормально показывать товар без закупочной цены.
 */
function costFor(price: number, index: number): number | null {
	if (NO_COST_INDEXES.includes(index)) return null
	const factors = [0.62, 0.7, 0.78, 0.55, 0.66]
	return Math.round((price * factors[index % factors.length]) / 100) * 100
}

async function createAllProducts(
	marketId: string,
	categories: { id: string }[],
	productList: typeof MARKET_1_PRODUCTS
) {
	const products: SeedProduct[] = []
	let index = 0
	for (let i = 0; i < categories.length; i++) {
		const chunk = productList.slice(i * 5, (i + 1) * 5)
		for (const p of chunk) {
			const costPrice = costFor(p.price, index)
			const product = await prisma.product.create({
				data: {
					name: p.name,
					description: p.description,
					price: p.price,
					costPrice,
					unit: p.unit,
					quantity: p.quantity,
					marketId,
					categoryId: categories[i].id,
					lowStockThreshold: 5,
					image: null
				}
			})
			products.push({
				id: product.id,
				name: product.name,
				price: p.price,
				costPrice,
				initialQuantity: p.quantity
			})
			index++
		}
	}
	return products
}

async function createDebtors(marketId: string, list: DebtorSeed[]) {
	return Promise.all(
		list.map(d =>
			prisma.debtor.create({
				data: {
					name: d.name,
					phone: d.phone,
					note: d.note,
					creditLimit: d.creditLimit,
					defaultDueDays: d.defaultDueDays,
					lastRemindedAt:
						d.remindedDaysAgo == null ? null : ago(d.remindedDaysAgo),
					marketId
				}
			})
		)
	)
}

function line(product: SeedProduct, quantity: number, discount = 0, markup = 0): Line {
	return {
		productId: product.id,
		productName: product.name,
		quantity,
		price: product.price,
		costPrice: product.costPrice,
		discount,
		markup,
		totalPrice: product.price * quantity - discount + markup
	}
}

/** Строка плана: [индекс товара, количество, скидка?, надбавка?]. */
type LinePlan = [number, number, number?, number?]

interface PaymentPlan {
	/** Сколько дней назад пришёл платёж (= дню долга — это аванс при выдаче). */
	daysAgo: number
	/** Доля от суммы долга. Если платежи в сумме дают 1 — долг погашен. */
	fraction: number
	/** Кто принял деньги: тот, кто выдал долг, или владелец. */
	by: 'self' | 'owner'
	note?: string
}

interface DebtPlan {
	/** Индекс должника в DEBTOR_DATA_*. */
	debtor: number
	/** Индекс продавца (по кругу) либо владелец. */
	by: number | 'owner'
	daysAgo: number
	/** Если задано — долг выдан столько минут назад (свежий, можно отменить). */
	minutesAgo?: number
	/** Срок возврата относительно сегодня: < 0 — просрочен, null — без срока. */
	due: number | null
	lines: LinePlan[]
	payments?: PaymentPlan[]
	note?: string
}

/**
 * Долги по сценариям должников (порядок DEBTOR_DATA_*):
 *  0 — надёжный: закрытая история + свежий долг в срок;
 *  1 — проблемный: тяжёлая просрочка, превышен лимит, напоминали недавно;
 *  2 — платит частями: «скоро срок» + закрытый долг в истории;
 *  3 — взял с авансом + небольшая просрочка;
 *  4 — всё вернул (ничего не должен);
 *  5 — долги без срока;
 *  6 — новый: свежий долг (минуты назад) + старый частично оплаченный.
 */
const DEBT_PLANS: DebtPlan[] = [
	{ debtor: 0, by: 0, daysAgo: 55, due: -40, lines: [[11, 3], [13, 5, 0, 1000]], payments: [{ daysAgo: 50, fraction: 0.5, by: 'owner' }, { daysAgo: 42, fraction: 0.5, by: 'owner' }] },
	{ debtor: 0, by: 1, daysAgo: 30, due: -20, lines: [[17, 2], [22, 2]], payments: [{ daysAgo: 24, fraction: 1, by: 'owner' }] },
	{ debtor: 0, by: 2, daysAgo: 6, due: 8, lines: [[3, 2], [5, 3, 0, 500]], note: 'Заберёт товар сам' },

	{ debtor: 1, by: 0, daysAgo: 52, due: -38, lines: [[4, 2], [17, 3], [18, 2, 0, 2000]], note: 'Обещал вернуть к концу месяца' },
	{ debtor: 1, by: 1, daysAgo: 20, due: -9, lines: [[19, 3], [21, 2], [2, 4, 0, 1000]], payments: [{ daysAgo: 12, fraction: 0.2, by: 'self' }] },

	{ debtor: 2, by: 2, daysAgo: 14, due: 2, lines: [[8, 6], [9, 5], [14, 3, 0, 1500]], payments: [{ daysAgo: 9, fraction: 0.3, by: 'self' }, { daysAgo: 3, fraction: 0.3, by: 'owner' }] },
	{ debtor: 2, by: 0, daysAgo: 40, due: -30, lines: [[0, 4], [1, 4]], payments: [{ daysAgo: 33, fraction: 0.5, by: 'self' }, { daysAgo: 20, fraction: 0.5, by: 'owner' }] },

	{ debtor: 3, by: 0, daysAgo: 2, due: 12, lines: [[4, 1], [20, 2, 0, 1000]], payments: [{ daysAgo: 2, fraction: 0.25, by: 'self' }] },
	{ debtor: 3, by: 1, daysAgo: 25, due: -5, lines: [[6, 5], [7, 4]] },

	{ debtor: 4, by: 'owner', daysAgo: 40, due: -25, lines: [[12, 4], [15, 3]], payments: [{ daysAgo: 35, fraction: 0.4, by: 'owner' }, { daysAgo: 28, fraction: 0.6, by: 'owner' }] },
	{ debtor: 4, by: 1, daysAgo: 18, due: -4, lines: [[16, 5], [23, 2, 0, 500]], payments: [{ daysAgo: 15, fraction: 1, by: 'self' }] },

	{ debtor: 5, by: 2, daysAgo: 9, due: null, lines: [[21, 3], [22, 2]] },
	{ debtor: 5, by: 0, daysAgo: 4, due: null, lines: [[9, 4], [8, 3, 0, 500]], note: 'Срок — по договорённости' },

	{ debtor: 6, by: 0, daysAgo: 0, minutesAgo: 3, due: 7, lines: [[1, 2], [6, 2, 0, 500]], note: 'Свежая запись — её можно отменить в течение 10 минут' },
	{ debtor: 6, by: 1, daysAgo: 33, due: -3, lines: [[18, 1], [13, 2]], payments: [{ daysAgo: 20, fraction: 0.5, by: 'self' }] },

	// Прошлогодние долги, давно закрытые: нужны для сравнения «год к году».
	{ debtor: 4, by: 1, daysAgo: 372, due: -350, lines: [[12, 3], [15, 2, 0, 500]], payments: [{ daysAgo: 366, fraction: 1, by: 'self' }] },
	{ debtor: 0, by: 0, daysAgo: 369, due: -345, lines: [[11, 2], [16, 4]], payments: [{ daysAgo: 360, fraction: 1, by: 'self' }] },
	{ debtor: 2, by: 2, daysAgo: 375, due: -355, lines: [[0, 3], [14, 2, 0, 500]], payments: [{ daysAgo: 367, fraction: 1, by: 'self' }] }
]

const CUSTOMERS = ['Иван', 'Мария', 'Сардор', 'Камола', 'Отабек', 'Нилуфар']
const SALE_NOTES = [
	'Оплатил при получении',
	'Постоянный покупатель',
	'Просил чек',
	'Забрал в тот же день'
]

interface SalePlan {
	index: number
	by: 'owner' | number
	daysAgo: number
	minutes: number
	paymentType: 'CASH' | 'CARD'
	customerName: string | null
	note: string | null
	lines: LinePlan[]
}

/** Индексы продаж, по которым ниже делаются возвраты (у них 2 строки, qty ≥ 4). */
const REFUND_FULL = 5
const REFUND_TWICE = 9
const REFUND_PARTIAL = 14

const BASE_SALES = 36

/**
 * Дополнительные продажи (индексы с 36): вчера — чтобы «сегодня» сравнивалось
 * не с пустым днём; сегодня — продажа с возвратом; год назад — чтобы
 * сравнение «год к году» имело с чем сравнивать.
 */
const EXTRA_SALES: {
	daysAgo: number
	minutes: number
	/** Продавец по индексу (по кругу); без значения — по общему правилу. */
	by?: number
}[] = [
	{ daysAgo: 0, minutes: 120 },
	{ daysAgo: 1, minutes: 200 },
	{ daysAgo: 1, minutes: 500 },
	{ daysAgo: 366, minutes: 300, by: 0 },
	{ daysAgo: 368, minutes: 100, by: 1 },
	{ daysAgo: 371, minutes: 400, by: 2 },
	{ daysAgo: 374, minutes: 50, by: 0 },
	{ daysAgo: 376, minutes: 250, by: 1 },
	{ daysAgo: 378, minutes: 350, by: 2 }
]
const SALE_TODAY_WITH_REFUND = 36
const SALE_YESTERDAY_WITH_REFUND = 37
const SALE_LAST_YEAR_WITH_REFUND = 40

/**
 * 36 продаж за ~55 дней (+ дополнительные, см. EXTRA_SALES): сегодня несколько, остальные размазаны, время суток
 * разное — иначе графики (тренд, дни недели, тепловая карта по часам) пустые.
 */
function buildSalePlans(sellerCount: number, usable: number[]): SalePlan[] {
	const pick = (n: number) => usable[n % usable.length]
	const plans: SalePlan[] = []
	let cursor = 0

	for (let i = 0; i < BASE_SALES + EXTRA_SALES.length; i++) {
		const extra = i >= BASE_SALES ? EXTRA_SALES[i - BASE_SALES] : null
		// Каждый третий чек оформляет владелец, остальные — продавцы по очереди
		// парами, чтобы у каждого продавца были и продажи, и долги.
		const by: 'owner' | number =
			extra?.by != null
				? extra.by % sellerCount
				: i % 3 === 0
					? 'owner'
					: Math.floor(i / 3) % sellerCount
		const isSeller = by !== 'owner'
		let lines: LinePlan[]

		if ([REFUND_FULL, REFUND_TWICE, REFUND_PARTIAL].includes(i)) {
			lines = [
				[pick(cursor), 4, i === REFUND_PARTIAL ? 2000 : 0],
				[pick(cursor + 1), 2]
			]
			cursor += 2
		} else {
			const count = 1 + (i % 3)
			lines = []
			for (let k = 0; k < count; k++) {
				const hasDiscount = (i + k) % 5 === 0
				// Надбавка есть только у продавцов — из неё копится баланс выплат.
				const hasMarkup = isSeller && !hasDiscount && (i + k) % 4 === 0
				lines.push([
					pick(cursor + k),
					1 + ((i + k) % 4),
					hasDiscount ? 1000 : 0,
					hasMarkup ? 500 + ((i + k) % 5) * 500 : 0
				])
			}
			cursor += count
		}

		plans.push({
			index: i,
			by,
			daysAgo: extra ? extra.daysAgo : i < 4 ? 0 : Math.floor(i * 1.55),
			minutes: extra ? extra.minutes : i < 4 ? 30 + i * 90 : (i * 137) % 600,
			paymentType: i % 3 === 2 ? 'CARD' : 'CASH',
			customerName: i % 4 === 1 ? CUSTOMERS[i % CUSTOMERS.length] : null,
			note: i % 6 === 2 ? SALE_NOTES[i % SALE_NOTES.length] : null,
			lines
		})
	}
	return plans
}

interface CreatedTx {
	id: string
	type: 'SALE' | 'DEBT'
	createdById: string
	createdAt: Date
	paymentType: 'CASH' | 'CARD' | 'CREDIT'
	items: Line[]
	dbItems: { id: string; productId: string; quantity: number }[]
}

async function createSales(
	marketId: string,
	products: SeedProduct[],
	sellers: Seller[],
	owner: Owner
) {
	const usable = products.map((_, i) => i).filter(i => i !== DEAD_STOCK_INDEX)
	const plans = buildSalePlans(sellers.length, usable)
	const created: (CreatedTx & { plan: SalePlan })[] = []

	for (const plan of plans) {
		const creator = plan.by === 'owner' ? owner : sellers[plan.by]
		const items = plan.lines.map(([pi, qty, discount, markup]) =>
			line(products[pi], qty, discount ?? 0, markup ?? 0)
		)
		const createdAt = ago(plan.daysAgo, plan.minutes)
		const total = items.reduce((s, i) => s + i.totalPrice, 0)

		const tx = await prisma.transaction.create({
			data: {
				marketId,
				createdById: creator.id,
				type: 'SALE',
				paymentType: plan.paymentType,
				customerName: plan.customerName,
				note: plan.note,
				totalAmount: total,
				discountAmount: items.reduce((s, i) => s + i.discount, 0),
				markupAmount: items.reduce((s, i) => s + i.markup, 0),
				remainingAmount: 0,
				status: 'PAID',
				createdAt,
				items: { createMany: { data: items } }
			},
			include: { items: true }
		})
		created.push({
			id: tx.id,
			type: 'SALE',
			createdById: creator.id,
			createdAt,
			paymentType: plan.paymentType,
			items,
			dbItems: tx.items,
			plan
		})
	}
	return created
}

async function createDebts(
	marketId: string,
	products: SeedProduct[],
	debtors: { id: string }[],
	sellers: Seller[],
	owner: Owner
) {
	const created: CreatedTx[] = []

	for (const [n, plan] of DEBT_PLANS.entries()) {
		const creator = plan.by === 'owner' ? owner : sellers[plan.by % sellers.length]
		const items = plan.lines.map(([pi, qty, discount, markup]) =>
			line(products[pi], qty, discount ?? 0, markup ?? 0)
		)
		const total = round2(items.reduce((s, i) => s + i.totalPrice, 0))
		const createdAt =
			plan.minutesAgo != null
				? ago(0, plan.minutesAgo)
				: ago(plan.daysAgo, (n * 173) % 600)

		// Суммы платежей считаем накопительно: последний платёж гасит остаток
		// до копейки, чтобы remainingAmount == total − Σ платежей без дрейфа.
		const payments: {
			amount: number
			createdAt: Date
			createdById: string
			note: string | null
		}[] = []
		let paid = 0
		for (const [k, p] of (plan.payments ?? []).entries()) {
			const isLast = k === (plan.payments ?? []).length - 1
			const amount =
				isLast && Math.abs(paid + total * p.fraction - total) < 1
					? round2(total - paid)
					: round2(total * p.fraction)
			paid = round2(paid + amount)
			payments.push({
				amount,
				// Аванс приходит в ту же секунду, что и сам долг.
				createdAt: p.daysAgo === plan.daysAgo ? createdAt : ago(p.daysAgo, 60),
				createdById: p.by === 'owner' ? owner.id : creator.id,
				note: p.note ?? null
			})
		}
		const remaining = round2(total - paid)
		const status = remaining <= 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'ACTIVE'

		const tx = await prisma.transaction.create({
			data: {
				marketId,
				createdById: creator.id,
				debtorId: debtors[plan.debtor].id,
				type: 'DEBT',
				paymentType: 'CREDIT',
				note: plan.note ?? null,
				totalAmount: total,
				discountAmount: items.reduce((s, i) => s + i.discount, 0),
				markupAmount: items.reduce((s, i) => s + i.markup, 0),
				remainingAmount: remaining,
				status,
				dueDate: plan.due == null ? null : new Date(NOW + plan.due * DAY),
				createdAt,
				items: { createMany: { data: items } },
				payments: { create: payments }
			},
			include: { items: true }
		})
		created.push({
			id: tx.id,
			type: 'DEBT',
			createdById: creator.id,
			createdAt,
			paymentType: 'CREDIT',
			items,
			dbItems: tx.items
		})
	}
	return created
}

interface RefundResult {
	/** productId → сколько единиц вернулось на склад. */
	restocked: Map<string, number>
	refundCount: number
}

interface RefundPlan {
	/** Индекс продажи (SalePlan.index). */
	sale: number
	/** Какие строки и сколько единиц вернули; без picks — все строки целиком. */
	picks?: { itemIdx: number; quantity: number }[]
	reason: string
	/** Через сколько дней после продажи оформлен возврат. */
	daysAfter: number
}

/**
 * Возвраты распределены по времени так, чтобы у каждого окна дашборда
 * (сегодня / неделя / месяц и прошлый месяц / год и прошлый год) были и
 * возвраты, и с чем сравнивать:
 *  - полный возврат; два частичных возврата одной продажи; частичный возврат
 *    строки со скидкой;
 *  - возвраты месяц назад (прошлый месяц) и сегодня;
 *  - прошлогодний возврат.
 */
const REFUND_PLANS: RefundPlan[] = [
	{ sale: REFUND_FULL, reason: 'Покупатель передумал', daysAfter: 1 },
	{ sale: REFUND_TWICE, picks: [{ itemIdx: 0, quantity: 1 }], reason: 'Брак: повреждена упаковка', daysAfter: 1 },
	{ sale: REFUND_TWICE, picks: [{ itemIdx: 1, quantity: 1 }], reason: 'Не подошёл товар', daysAfter: 3 },
	{ sale: REFUND_PARTIAL, picks: [{ itemIdx: 0, quantity: 2 }], reason: 'Вернули половину партии', daysAfter: 2 },
	{ sale: 22, picks: [{ itemIdx: 0, quantity: 1 }], reason: 'Истёк срок годности', daysAfter: 1 },
	{ sale: 28, picks: [{ itemIdx: 0, quantity: 1 }], reason: 'Покупатель передумал', daysAfter: 1 },
	{ sale: SALE_TODAY_WITH_REFUND, picks: [{ itemIdx: 0, quantity: 1 }], reason: 'Ошибка при оформлении', daysAfter: 0.01 },
	{ sale: SALE_YESTERDAY_WITH_REFUND, picks: [{ itemIdx: 0, quantity: 1 }], reason: 'Покупатель передумал', daysAfter: 0.05 },
	{ sale: SALE_LAST_YEAR_WITH_REFUND, picks: [{ itemIdx: 0, quantity: 1 }], reason: 'Брак', daysAfter: 1 }
]

/**
 * Возвраты поверх продаж — зеркало TransactionsService.refund(): двигают
 * refundedQuantity, возвращают товар на склад, создают REFUND со ссылкой на
 * исходные строки (цена, скидка, надбавка, закупочная — пропорционально
 * возвращаемому количеству), причина — в note. Статус исходной продажи
 * считается по итогу: REFUNDED, если возвращено всё до единицы, иначе
 * PARTIALLY_REFUNDED.
 */
async function createRefunds(
	marketId: string,
	sales: (CreatedTx & { plan: SalePlan })[],
	owner: Owner
): Promise<RefundResult> {
	const restocked = new Map<string, number>()
	const refundedByItem = new Map<string, number>() // dbItemId → возвращено
	const touched = new Set<string>()
	let refundCount = 0

	for (const plan of REFUND_PLANS) {
		const sale = sales.find(x => x.plan.index === plan.sale)!
		const picks =
			plan.picks ??
			sale.items.map((item, itemIdx) => ({ itemIdx, quantity: item.quantity }))

		const lines = picks.map(({ itemIdx, quantity }) => {
			const src = sale.items[itemIdx]
			const dbItem = sale.dbItems.find(
				d => d.productId === src.productId && d.quantity === src.quantity
			)!
			const unitNet = src.totalPrice / src.quantity
			return {
				dbItem,
				quantity,
				data: {
					productId: src.productId,
					productName: src.productName,
					quantity,
					price: src.price,
					costPrice: src.costPrice,
					discount: round2((src.discount / src.quantity) * quantity),
					markup: round2((src.markup / src.quantity) * quantity),
					totalPrice: round2(unitNet * quantity),
					refundOfItemId: dbItem.id
				}
			}
		})

		for (const l of lines) {
			await prisma.transactionItem.update({
				where: { id: l.dbItem.id },
				data: { refundedQuantity: { increment: l.quantity } }
			})
			refundedByItem.set(
				l.dbItem.id,
				(refundedByItem.get(l.dbItem.id) ?? 0) + l.quantity
			)
			restocked.set(
				l.data.productId,
				(restocked.get(l.data.productId) ?? 0) + l.quantity
			)
		}

		await prisma.transaction.create({
			data: {
				marketId,
				createdById: owner.id,
				refundOfId: sale.id,
				type: 'REFUND',
				paymentType: sale.paymentType,
				note: plan.reason,
				totalAmount: round2(lines.reduce((s, l) => s + l.data.totalPrice, 0)),
				discountAmount: round2(lines.reduce((s, l) => s + l.data.discount, 0)),
				markupAmount: round2(lines.reduce((s, l) => s + l.data.markup, 0)),
				remainingAmount: 0,
				status: 'PAID',
				createdAt: new Date(
					Math.min(sale.createdAt.getTime() + plan.daysAfter * DAY, NOW - MINUTE)
				),
				items: { create: lines.map(l => l.data) }
			}
		})
		touched.add(sale.id)
		refundCount++
	}

	for (const sale of sales.filter(x => touched.has(x.id))) {
		const fully = sale.dbItems.every(
			d => (refundedByItem.get(d.id) ?? 0) >= d.quantity
		)
		await prisma.transaction.update({
			where: { id: sale.id },
			data: { status: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED' }
		})
	}

	return { restocked, refundCount }
}

/**
 * Остатки приводим в соответствие с продажами: из стартового количества
 * вычитаем проданное, прибавляем возвращённое (не ниже нуля). Затем два
 * ходовых товара намеренно «на исходе» — чтобы раздел «Заканчивается» и
 * рекомендации по закупке не были пустыми.
 */
async function syncStock(
	products: SeedProduct[],
	txs: CreatedTx[],
	restocked: Map<string, number>
) {
	const sold = new Map<string, number>()
	for (const tx of txs) {
		for (const item of tx.items) {
			sold.set(item.productId, (sold.get(item.productId) ?? 0) + item.quantity)
		}
	}

	for (const [i, product] of products.entries()) {
		let quantity = Math.max(
			0,
			product.initialQuantity -
				(sold.get(product.id) ?? 0) +
				(restocked.get(product.id) ?? 0)
		)
		if (i === 1) quantity = 4
		if (i === 6) quantity = 2
		await prisma.product.update({ where: { id: product.id }, data: { quantity } })
	}
}

/**
 * Баланс продавца = Σ markup по его транзакциям (SALE/DEBT) минус выплаты.
 * Выплат две (30% и 20% накопленного) — остаётся и история выдач, и баланс
 * к выплате.
 */
async function createSellerCredits(
	txs: CreatedTx[],
	sellers: Seller[],
	owner: Owner
) {
	for (const seller of sellers) {
		const earned = txs
			.filter(t => t.createdById === seller.id)
			.reduce((sum, t) => sum + t.items.reduce((s, i) => s + i.markup, 0), 0)
		if (earned <= 0) continue

		const payouts: [number, number, string][] = [
			[0.3, 21, 'Частичная выплата накопленной надбавки'],
			[0.2, 6, 'Доплата за неделю']
		]
		for (const [share, daysAgo, note] of payouts) {
			const amount = Math.round((earned * share) / 100) * 100
			if (amount <= 0) continue
			await prisma.sellerCredit.create({
				data: {
					sellerId: seller.id,
					amount,
					note,
					createdById: owner.id,
					createdAt: ago(daysAgo)
				}
			})
		}
	}
}

async function seedMarket(
	label: string,
	users: MarketUsers,
	categories: typeof CATEGORY_DATA_1,
	productList: typeof MARKET_1_PRODUCTS,
	debtorList: DebtorSeed[]
) {
	const marketId = users.market.id

	const cats = await createCategories(marketId, categories)
	const products = await createAllProducts(marketId, cats, productList)
	const debtors = await createDebtors(marketId, debtorList)
	console.log(`  ✓ ${label}: категорий ${cats.length}, товаров ${products.length}, должников ${debtors.length}`)

	const sales = await createSales(marketId, products, users.sellers, users.owner)
	const debts = await createDebts(marketId, products, debtors, users.sellers, users.owner)
	console.log(`  ✓ ${label}: продаж ${sales.length}, долгов ${debts.length}`)

	const { restocked, refundCount } = await createRefunds(marketId, sales, users.owner)
	console.log(`  ✓ ${label}: возвратов ${refundCount}`)

	await syncStock(products, [...sales, ...debts], restocked)
	await createSellerCredits([...sales, ...debts], users.sellers, users.owner)
	console.log(`  ✓ ${label}: остатки и выплаты продавцам`)
}

async function main() {
	console.log('Очистка таблиц...')
	await clearTables()

	console.log('Создание администратора...')
	const admin = await createAdmin()
	console.log(`  ✓ Администратор: ${admin.email}`)

	console.log('Создание рынков и сотрудников...')
	const m1 = await createMarketWithStaff(MARKET_1_SPEC)
	const m2 = await createMarketWithStaff(MARKET_2_SPEC)

	console.log('Наполнение рынков (товары, должники, продажи, долги, возвраты)...')
	await seedMarket('Центральный', m1, CATEGORY_DATA_1, MARKET_1_PRODUCTS, DEBTOR_DATA_1)
	await seedMarket('Восточный', m2, CATEGORY_DATA_2, MARKET_2_PRODUCTS, DEBTOR_DATA_2)

	console.log('\n✅ Сидирование завершено!')
	console.log(`\nУчётные данные (пароль у всех 12345678Aa):`)
	console.log(`  Админ: admin@tradecrm.com`)
	console.log(`  Владельцы: alisher@tradecrm.com, dilnoza@tradecrm.com`)
	console.log(
		`  Продавцы: sultonzoda2011@gmail.com, bakhtiyar@tradecrm.com, madina@tradecrm.com, jasur@tradecrm.com, nigora@tradecrm.com`
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
