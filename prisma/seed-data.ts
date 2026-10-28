import { ProductUnit } from '@prisma/client'

export interface MarketSeedSpec {
	name: string
	address: string
	owner: { name: string; email: string }
	sellers: Array<{ name: string; email: string }>
}

export const MARKET_1_SPEC: MarketSeedSpec = {
	name: 'Рынок Центральный',
	address: 'ул. Ленина, 15, г. Ташкент',
	owner: { name: 'Алишер Каримов', email: 'alisher@tradecrm.com' },
	sellers: [
		{ name: 'Султонзода', email: 'sultonzoda2011@gmail.com' },
		{ name: 'Бахтияр Рахимов', email: 'bakhtiyar@tradecrm.com' },
		{ name: 'Мадина Юсупова', email: 'madina@tradecrm.com' }
	]
}

export const MARKET_2_SPEC: MarketSeedSpec = {
	name: 'Рынок Восточный',
	address: 'ул. Амира Темура, 42, г. Ташкент',
	owner: { name: 'Дилноза Азимова', email: 'dilnoza@tradecrm.com' },
	sellers: [
		{ name: 'Жасур Ахмедов', email: 'jasur@tradecrm.com' },
		{ name: 'Нигора Камилова', email: 'nigora@tradecrm.com' }
	]
}

export const CATEGORY_DATA_1 = [
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

export const CATEGORY_DATA_2 = [
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

export const MARKET_1_PRODUCTS = [
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
	{ name: 'Мука пшеничная', description: '1кг', price: 7000, unit: ProductUnit.KG, quantity: 3 }
]

export const MARKET_2_PRODUCTS = [
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
	{ name: 'Томатная паста', description: '250г', price: 7000, unit: ProductUnit.PCS, quantity: 0 }
]

/**
 * Должники — по одному на каждый «сценарий», чтобы все состояния интерфейса
 * (риск, просрочка, «скоро срок», закрытые, без срока, превышенный лимит,
 * свежий долг) на живых данных были непустыми. Порядок важен: сами долги
 * привязаны к должникам по индексу в seed.ts (DEBT_PLANS).
 *
 * remindedDaysAgo — когда последний раз напоминали (null — ни разу).
 */
export interface DebtorSeed {
	name: string
	phone: string
	note: string | null
	creditLimit: number | null
	defaultDueDays: number | null
	remindedDaysAgo: number | null
}

export const DEBTOR_DATA_1: DebtorSeed[] = [
	{ name: 'Салимов Азиз', phone: '+998901234567', note: null, creditLimit: 500000, defaultDueDays: 14, remindedDaysAgo: null },
	{ name: 'Рахимова Гульноза', phone: '+998902345678', note: 'Звонить после обеда', creditLimit: 150000, defaultDueDays: 7, remindedDaysAgo: 2 },
	{ name: 'Умаров Бахтиёр', phone: '+998903456789', note: 'Ряд 5, лавка 12', creditLimit: 300000, defaultDueDays: 10, remindedDaysAgo: 1 },
	{ name: 'Каримова Зухра', phone: '+998904567890', note: null, creditLimit: 400000, defaultDueDays: 14, remindedDaysAgo: null },
	{ name: 'Турсунов Фаррух', phone: '+998905678901', note: 'Платит всегда в срок', creditLimit: null, defaultDueDays: 30, remindedDaysAgo: null },
	{ name: 'Назаров Рустам', phone: '+998906789012', note: 'Срок обговаривает сам', creditLimit: 200000, defaultDueDays: null, remindedDaysAgo: 6 },
	{ name: 'Алиев Тимур', phone: '+998907890123', note: 'Новый клиент, пришёл по рекомендации', creditLimit: 100000, defaultDueDays: 7, remindedDaysAgo: null }
]

export const DEBTOR_DATA_2: DebtorSeed[] = [
	{ name: 'Азимова Наргиза', phone: '+998911234567', note: null, creditLimit: 500000, defaultDueDays: 14, remindedDaysAgo: null },
	{ name: 'Собиров Джамшид', phone: '+998912345678', note: 'Звонить после 18:00', creditLimit: 150000, defaultDueDays: 7, remindedDaysAgo: 3 },
	{ name: 'Исламова Мухаббат', phone: '+998913456789', note: 'Лавка у входа, ряд 2', creditLimit: 300000, defaultDueDays: 10, remindedDaysAgo: 1 },
	{ name: 'Хакимов Шерзод', phone: '+998914567890', note: null, creditLimit: 400000, defaultDueDays: 14, remindedDaysAgo: null },
	{ name: 'Усманова Лола', phone: '+998915678901', note: 'Платит всегда в срок', creditLimit: null, defaultDueDays: 30, remindedDaysAgo: null },
	{ name: 'Бекмуродов Санжар', phone: '+998916789012', note: 'Срок обговаривает сам', creditLimit: 200000, defaultDueDays: null, remindedDaysAgo: 5 },
	{ name: 'Ходжаева Дилафруз', phone: '+998917890123', note: 'Новый клиент', creditLimit: 100000, defaultDueDays: 7, remindedDaysAgo: null }
]
