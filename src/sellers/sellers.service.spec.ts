import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { compare } from 'bcrypt'
import { ROLES_KEY } from '../auth/decorators/roles.decorator'
import { PASSWORD_PATTERN } from '../common/utils/password.util'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { SellersController } from './sellers.controller'
import { SellersService } from './sellers.service'
import * as earnings from './sellers-earnings.util'

jest.mock('./sellers-earnings.util')
const fetchBalances = earnings.fetchBalances as jest.Mock
const fetchPeriodTotals = earnings.fetchPeriodTotals as jest.Mock
const fetchEarningsFeed = earnings.fetchEarningsFeed as jest.Mock
const countEarningsFeed = earnings.countEarningsFeed as jest.Mock

const owner: JwtPayload = {
	sub: 'owner-1',
	id: 'owner-1',
	email: 'o@x.com',
	name: 'Owner',
	role: Role.OWNER,
	marketId: 'market-1'
}
const admin: JwtPayload = { ...owner, sub: 'admin-1', id: 'admin-1', role: Role.ADMIN, marketId: undefined }

const bal = (over: Partial<earnings.SellerBalance> = {}): earnings.SellerBalance => ({
	sellerId: 's1',
	earned: 100,
	refunded: 0,
	paidOut: 0,
	balance: 100,
	pendingInDebts: 0,
	...over
})

const sellerRow = (over: Record<string, unknown> = {}) => ({
	id: 's1',
	name: 'Ali',
	email: 'ali@x.com',
	phone: null,
	image: null,
	role: 'SELLER',
	isActive: true,
	deactivatedAt: null,
	passwordChangedAt: null,
	createdAt: new Date('2026-10-01T00:00:00Z'),
	market: { id: 'market-1', name: 'M', address: 'A', image: null },
	...over
})

const knownError = (code: string) =>
	new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' })

describe('SellersService', () => {
	let service: SellersService
	let prisma: any
	let tx: any
	let storage: any
	let config: any
	let transactions: any

	beforeEach(() => {
		tx = {
			$queryRaw: jest.fn().mockResolvedValue([]),
			sellerCredit: { findFirst: jest.fn(), create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })) }
		}
		prisma = {
			user: {
				findFirst: jest.fn().mockResolvedValue(sellerRow()),
				findMany: jest.fn().mockResolvedValue([]),
				findUnique: jest.fn(),
				count: jest.fn().mockResolvedValue(0),
				create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
				update: jest.fn(async ({ data }: any) => ({ ...sellerRow(), ...data })),
				delete: jest.fn().mockResolvedValue(undefined),
				groupBy: jest.fn().mockResolvedValue([])
			},
			market: { findUnique: jest.fn() },
			transaction: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
			payment: { count: jest.fn().mockResolvedValue(0) },
			sellerCredit: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
			$queryRaw: jest.fn(),
			$transaction: jest.fn(async (fn: any) => fn(tx))
		}
		storage = { save: jest.fn().mockResolvedValue('img-url'), replace: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) }
		config = { get: jest.fn().mockReturnValue(4) }
		transactions = { findAll: jest.fn().mockResolvedValue({ data: [], meta: { total: 0 } }) }
		service = new SellersService(prisma, storage, config, transactions)

		fetchBalances.mockImplementation(async (_db: unknown, ids: string[]) => new Map(ids.map(id => [id, bal({ sellerId: id })])))
		fetchPeriodTotals.mockImplementation(
			async (_db: unknown, ids: string[]) => new Map(ids.map(id => [id, { salesCount: 0, sold: 0, earned: 0 }]))
		)
		fetchEarningsFeed.mockResolvedValue([])
		countEarningsFeed.mockResolvedValue(0)
	})

	describe('controller roles', () => {
		it('is closed to sellers', () => {
			expect(Reflect.getMetadata(ROLES_KEY, SellersController)).toEqual([Role.OWNER, Role.ADMIN])
		})
	})

	describe('IDOR scoping', () => {
		beforeEach(() => prisma.user.findFirst.mockResolvedValue(null))

		it('looks the seller up inside the caller market', async () => {
			prisma.user.findFirst.mockResolvedValue(sellerRow())
			await service.findOne('s1', 'market-1')
			expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({ id: 's1', role: 'SELLER', marketId: 'market-1' })
		})

		it('a seller of another market is "not found" for every read and write', async () => {
			const calls: Promise<unknown>[] = [
				service.findOne('s1', 'market-2'),
				service.findOneFull('s1', 'market-2'),
				service.getBalance('s1', 'market-2'),
				service.getEarnings('s1', {}, 'market-2'),
				service.listCredits('s1', {}, 'market-2'),
				service.createCredit('s1', { amount: 10 }, owner, 'market-2'),
				service.reverseCredit('s1', 'c1', {}, owner, 'market-2'),
				service.update('s1', { name: 'X' }, undefined, 'market-2'),
				service.deactivate('s1', 'market-2'),
				service.activate('s1', 'market-2'),
				service.resetPassword('s1', 'market-2'),
				service.remove('s1', 'market-2')
			]
			for (const call of calls) await expect(call).rejects.toThrow(NotFoundException)
			expect(prisma.user.update).not.toHaveBeenCalled()
			expect(prisma.user.delete).not.toHaveBeenCalled()
			expect(prisma.$transaction).not.toHaveBeenCalled()
		})
	})

	describe('create', () => {
		const dto = { name: 'Ali', email: 'ali@x.com', password: 'Passw0rd', phone: '+992 900 12-34-56' }

		beforeEach(() => prisma.user.findFirst.mockResolvedValue(null))

		it('an owner always creates in their own market, whatever marketId the form sent', async () => {
			await service.create({ ...dto, marketId: 'market-2' }, undefined, owner)
			const data = prisma.user.create.mock.calls[0][0].data
			expect(data.marketId).toBe('market-1')
			expect(data.role).toBe('SELLER')
			expect(data.phone).toBe('+992 900 12-34-56')
			expect(data.password).not.toBe('Passw0rd')
		})

		it('an admin must choose a market that exists', async () => {
			await expect(service.create(dto, undefined, admin)).rejects.toMatchObject({
				response: { code: 'SELLER_MARKET_REQUIRED' }
			})
			prisma.market.findUnique.mockResolvedValue(null)
			await expect(service.create({ ...dto, marketId: 'nope' }, undefined, admin)).rejects.toThrow(NotFoundException)

			prisma.market.findUnique.mockResolvedValue({ id: 'market-9' })
			prisma.user.findFirst.mockResolvedValue(null)
			await service.create({ ...dto, marketId: 'market-9' }, undefined, admin)
			expect(prisma.user.create.mock.calls[0][0].data.marketId).toBe('market-9')
		})

		it('an owner without a market cannot create sellers', async () => {
			await expect(service.create(dto, undefined, { ...owner, marketId: undefined })).rejects.toThrow(UnauthorizedException)
		})

		it('rejects a taken email with a machine-readable code', async () => {
			prisma.user.findFirst.mockResolvedValue(sellerRow())
			await expect(service.create(dto, undefined, owner)).rejects.toMatchObject({ response: { code: 'EMAIL_IN_USE' } })
			expect(prisma.user.create).not.toHaveBeenCalled()
		})
	})

	describe('update', () => {
		it('an empty phone clears it', async () => {
			await service.update('s1', { phone: '' }, undefined, 'market-1')
			expect(prisma.user.update.mock.calls[0][0].data.phone).toBeNull()
		})

		it('a new password is hashed and stamped', async () => {
			await service.update('s1', { password: 'NewPass1' }, undefined, 'market-1')
			const data = prisma.user.update.mock.calls[0][0].data
			expect(await compare('NewPass1', data.password)).toBe(true)
			expect(data.passwordChangedAt).toBeInstanceOf(Date)
		})

		it('only the sent fields are written', async () => {
			await service.update('s1', { name: 'Bek' }, undefined, 'market-1')
			expect(prisma.user.update.mock.calls[0][0].data).toEqual({ name: 'Bek' })
		})
	})

	describe('createCredit (payout)', () => {
		it('checks the balance and writes inside one transaction, after locking the seller row', async () => {
			fetchBalances.mockResolvedValue(new Map([['s1', bal({ balance: 100 })]]))
			await service.createCredit('s1', { amount: 40, note: ' наличными ' }, owner, 'market-1')

			expect(prisma.$transaction).toHaveBeenCalledTimes(1)
			expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
			expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE')
			// баланс читается через транзакцию, а не через общий клиент
			expect(fetchBalances.mock.calls.at(-1)![0]).toBe(tx)
			expect(tx.sellerCredit.create.mock.calls[0][0].data).toEqual({
				sellerId: 's1',
				amount: 40,
				note: 'наличными',
				createdById: 'owner-1'
			})
		})

		it('refuses more than the balance, with the balance in the details', async () => {
			fetchBalances.mockResolvedValue(new Map([['s1', bal({ balance: 30 })]]))
			await expect(service.createCredit('s1', { amount: 30.01 }, owner, 'market-1')).rejects.toMatchObject({
				response: { code: 'SELLER_PAYOUT_EXCEEDS_BALANCE', details: { balance: 30 } }
			})
			expect(tx.sellerCredit.create).not.toHaveBeenCalled()
		})

		it('refuses to pay when nothing is owed (zero or overpaid)', async () => {
			for (const balance of [0, -15]) {
				fetchBalances.mockResolvedValue(new Map([['s1', bal({ balance })]]))
				await expect(service.createCredit('s1', { amount: 1 }, owner, 'market-1')).rejects.toMatchObject({
					response: { code: 'SELLER_NOTHING_TO_PAY' }
				})
			}
			expect(tx.sellerCredit.create).not.toHaveBeenCalled()
		})

		it('two parallel payouts cannot both pass on the same balance', async () => {
			// Состояние «базы» и очередь под блокировкой строки — как FOR UPDATE.
			let balance = 100
			let queue: Promise<unknown> = Promise.resolve()
			prisma.$transaction.mockImplementation((fn: any) => {
				const run = queue.then(() => fn(tx))
				queue = run.catch(() => undefined)
				return run
			})
			fetchBalances.mockImplementation(async () => new Map([['s1', bal({ balance })]]))
			tx.sellerCredit.create.mockImplementation(async ({ data }: any) => {
				await Promise.resolve()
				balance -= data.amount
				return { id: 'new', ...data }
			})

			const results = await Promise.allSettled([
				service.createCredit('s1', { amount: 60 }, owner, 'market-1'),
				service.createCredit('s1', { amount: 60 }, owner, 'market-1')
			])

			expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
			const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
			expect(rejected.reason).toBeInstanceOf(BadRequestException)
			expect(rejected.reason.getResponse().code).toBe('SELLER_PAYOUT_EXCEEDS_BALANCE')
			expect(balance).toBe(40)
		})
	})

	describe('reverseCredit', () => {
		const original = { id: 'c1', sellerId: 's1', amount: 50, reversalOfId: null, reversal: null }

		it('adds an offsetting negative entry and keeps the original', async () => {
			tx.sellerCredit.findFirst.mockResolvedValue(original)
			await service.reverseCredit('s1', 'c1', { note: 'ошиблись' }, owner, 'market-1')

			expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE')
			expect(tx.sellerCredit.findFirst.mock.calls[0][0].where).toEqual({ id: 'c1', sellerId: 's1' })
			expect(tx.sellerCredit.create.mock.calls[0][0].data).toEqual({
				sellerId: 's1',
				amount: -50,
				note: 'ошиблись',
				createdById: 'owner-1',
				reversalOfId: 'c1'
			})
		})

		it('a payout of another seller is not found', async () => {
			tx.sellerCredit.findFirst.mockResolvedValue(null)
			await expect(service.reverseCredit('s1', 'c-other', {}, owner, 'market-1')).rejects.toThrow(NotFoundException)
			expect(tx.sellerCredit.create).not.toHaveBeenCalled()
		})

		it('a payout is cancelled once, and a cancellation cannot be cancelled', async () => {
			tx.sellerCredit.findFirst.mockResolvedValue({ ...original, reversal: { id: 'c2' } })
			await expect(service.reverseCredit('s1', 'c1', {}, owner, 'market-1')).rejects.toMatchObject({
				response: { code: 'SELLER_CREDIT_ALREADY_REVERSED' }
			})

			tx.sellerCredit.findFirst.mockResolvedValue({ id: 'c2', amount: -50, reversalOfId: 'c1', reversal: null })
			await expect(service.reverseCredit('s1', 'c2', {}, owner, 'market-1')).rejects.toMatchObject({
				response: { code: 'SELLER_CREDIT_NOT_REVERSIBLE' }
			})
			expect(tx.sellerCredit.create).not.toHaveBeenCalled()
		})

		it('a unique-constraint race is reported as "already cancelled"', async () => {
			tx.sellerCredit.findFirst.mockResolvedValue(original)
			tx.sellerCredit.create.mockRejectedValue(knownError('P2002'))
			await expect(service.reverseCredit('s1', 'c1', {}, owner, 'market-1')).rejects.toBeInstanceOf(ConflictException)
		})
	})

	describe('remove / deactivate / activate', () => {
		it('deletes a seller without history and removes the avatar', async () => {
			prisma.user.findFirst.mockResolvedValue(sellerRow({ image: 'img' }))
			await service.remove('s1', 'market-1')
			expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 's1' } })
			expect(storage.delete).toHaveBeenCalledWith('img')
		})

		it.each([
			['receipts', () => (prisma.transaction.count = jest.fn().mockResolvedValue(3))],
			['payments', () => (prisma.payment.count = jest.fn().mockResolvedValue(1))],
			['payouts', () => (prisma.sellerCredit.count = jest.fn().mockResolvedValue(2))]
		])('refuses to delete a seller with %s — disable instead', async (_name, arrange) => {
			arrange()
			await expect(service.remove('s1', 'market-1')).rejects.toMatchObject({ response: { code: 'SELLER_HAS_HISTORY' } })
			expect(prisma.user.delete).not.toHaveBeenCalled()
			expect(storage.delete).not.toHaveBeenCalled()
		})

		it('a foreign-key race on delete is the same 409, and the avatar stays', async () => {
			prisma.user.findFirst.mockResolvedValue(sellerRow({ image: 'img' }))
			prisma.user.delete.mockRejectedValue(knownError('P2003'))
			await expect(service.remove('s1', 'market-1')).rejects.toMatchObject({ response: { code: 'SELLER_HAS_HISTORY' } })
			expect(storage.delete).not.toHaveBeenCalled()
		})

		it('deactivate stamps the time; a repeat call changes nothing', async () => {
			await service.deactivate('s1', 'market-1')
			const data = prisma.user.update.mock.calls[0][0].data
			expect(data.isActive).toBe(false)
			expect(data.deactivatedAt).toBeInstanceOf(Date)

			prisma.user.update.mockClear()
			prisma.user.findFirst.mockResolvedValue(sellerRow({ isActive: false }))
			await service.deactivate('s1', 'market-1')
			expect(prisma.user.update).not.toHaveBeenCalled()
		})

		it('activate clears the stamp; a repeat call changes nothing', async () => {
			prisma.user.findFirst.mockResolvedValue(sellerRow({ isActive: false, deactivatedAt: new Date() }))
			await service.activate('s1', 'market-1')
			expect(prisma.user.update.mock.calls[0][0].data).toEqual({ isActive: true, deactivatedAt: null })

			prisma.user.update.mockClear()
			prisma.user.findFirst.mockResolvedValue(sellerRow())
			await service.activate('s1', 'market-1')
			expect(prisma.user.update).not.toHaveBeenCalled()
		})
	})

	describe('resetPassword', () => {
		it('returns a readable password that satisfies the rule, stores only its hash', async () => {
			const first = await service.resetPassword('s1', 'market-1')
			const second = await service.resetPassword('s1', 'market-1')

			expect(first.password).toHaveLength(10)
			expect(first.password).toMatch(PASSWORD_PATTERN)
			expect(first.password).not.toMatch(/[0OIl1]/)
			expect(second.password).not.toBe(first.password)

			const data = prisma.user.update.mock.calls[0][0].data
			expect(data.password).not.toBe(first.password)
			expect(await compare(first.password, data.password)).toBe(true)
			expect(data.passwordChangedAt).toBeInstanceOf(Date)
		})
	})

	describe('findAll', () => {
		it('without stats it is a plain DB page (pickers stay cheap)', async () => {
			prisma.user.count.mockResolvedValue(1)
			prisma.user.findMany.mockResolvedValue([sellerRow()])
			await service.findAll({ page: 1, limit: 20 }, 'market-1')
			expect(fetchBalances).not.toHaveBeenCalled()
			expect(prisma.user.findMany.mock.calls[0][0].take).toBe(20)
		})

		it('filters by status and searches name, email and phone', async () => {
			await service.findAll({ status: 'disabled', search: '900' } as any, 'market-1')
			const where = prisma.user.findMany.mock.calls[0][0].where
			expect(where).toMatchObject({ role: 'SELLER', marketId: 'market-1', isActive: false })
			expect(where.OR).toHaveLength(3)

			await service.findAll({ status: 'active' } as any, 'market-1')
			expect(prisma.user.findMany.mock.calls[1][0].where.isActive).toBe(true)
		})

		it('with stats: sorts by what is owed, working sellers first, empty values last', async () => {
			prisma.user.findMany.mockResolvedValue([
				sellerRow({ id: 'a', name: 'A', email: 'a@x', createdAt: new Date('2026-01-01') }),
				sellerRow({ id: 'b', name: 'B', email: 'b@x', createdAt: new Date('2026-01-02') }),
				sellerRow({ id: 'c', name: 'C', email: 'c@x', createdAt: new Date('2026-01-03'), isActive: false }),
				sellerRow({ id: 'd', name: 'D', email: 'd@x', createdAt: new Date('2026-01-04') })
			])
			fetchBalances.mockResolvedValue(
				new Map([
					['a', bal({ sellerId: 'a', balance: 10 })],
					['b', bal({ sellerId: 'b', balance: 300 })],
					['c', bal({ sellerId: 'c', balance: 999 })],
					['d', bal({ sellerId: 'd', balance: -5 })]
				])
			)
			const res: any = await service.findAll({ sortBy: 'balance', sortOrder: 'desc', page: 1, limit: 20 } as any, 'market-1')
			// отключённый c — в конце, хоть у него и самый большой баланс
			expect(res.data.map((r: any) => r.id)).toEqual(['b', 'a', 'd', 'c'])
			expect(res.data[0].stats.balance).toBe(300)
			expect(res.meta).toMatchObject({ total: 4, totalPages: 1 })
		})

		it('with stats: a seller who never sold goes last by lastSaleAt in either direction', async () => {
			prisma.user.findMany.mockResolvedValue([sellerRow({ id: 'a', name: 'A' }), sellerRow({ id: 'b', name: 'B' })])
			prisma.transaction.groupBy.mockResolvedValue([{ createdById: 'b', _max: { createdAt: new Date('2026-11-01') } }])
			for (const sortOrder of ['asc', 'desc']) {
				const res: any = await service.findAll({ sortBy: 'lastSaleAt', sortOrder } as any, 'market-1')
				expect(res.data.map((r: any) => r.id)).toEqual(['b', 'a'])
			}
		})

		it('with stats: pages are cut after sorting', async () => {
			prisma.user.findMany.mockResolvedValue(
				['a', 'b', 'c'].map((id, i) => sellerRow({ id, name: id.toUpperCase(), email: `${id}@x`, createdAt: new Date(2026, 0, i + 1) }))
			)
			const res: any = await service.findAll({ withStats: true, sortBy: 'name', sortOrder: 'asc', page: 2, limit: 2 } as any, 'market-1')
			expect(res.data.map((r: any) => r.id)).toEqual(['c'])
			expect(res.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 })
		})
	})

	describe('summary', () => {
		it('owed is only positive balances; overpayments are shown apart', async () => {
			prisma.user.groupBy.mockResolvedValue([
				{ isActive: true, _count: { _all: 3 } },
				{ isActive: false, _count: { _all: 1 } }
			])
			prisma.user.findMany.mockResolvedValue([sellerRow({ id: 'a' }), sellerRow({ id: 'b' }), sellerRow({ id: 'c' })])
			fetchBalances.mockResolvedValue(
				new Map([
					['a', bal({ sellerId: 'a', balance: 120.5, pendingInDebts: 20 })],
					['b', bal({ sellerId: 'b', balance: -30 })],
					['c', bal({ sellerId: 'c', balance: 0 })]
				])
			)
			fetchPeriodTotals.mockResolvedValue(
				new Map([
					['a', { salesCount: 4, sold: 1000, earned: 80 }],
					['b', { salesCount: 1, sold: 50.25, earned: 5 }],
					['c', { salesCount: 0, sold: 0, earned: 0 }]
				])
			)

			const res = await service.summary({}, 'market-1')
			expect(res).toMatchObject({
				counts: { active: 3, disabled: 1 },
				salesCount: 5,
				sold: 1050.25,
				earned: 85,
				toPay: 120.5,
				toPayCount: 1,
				overpaid: 30,
				pendingInDebts: 20
			})
			// по умолчанию в шапку попадают только работающие
			expect(prisma.user.findMany.mock.calls[0][0].where.isActive).toBe(true)
		})
	})

	describe('findOneFull', () => {
		it('puts history flag, balance, month totals, payouts and the feed into one answer', async () => {
			prisma.transaction.count.mockResolvedValue(2)
			fetchPeriodTotals.mockResolvedValue(new Map([['s1', { salesCount: 2, sold: 300, earned: 25 }]]))
			const res = await service.findOneFull('s1', 'market-1')

			expect(res.seller.hasHistory).toBe(true)
			expect(res.month).toMatchObject({ salesCount: 2, sold: 300, earned: 25 })
			expect(res.balance.balance).toBe(100)
			expect(res.feed.entries.meta.total).toBe(0)
			expect(transactions.findAll).toHaveBeenCalledWith(expect.objectContaining({ createdById: 's1', limit: 5 }), 'market-1')
		})
	})

	describe('getEarnings', () => {
		it('pages the feed and returns the balance it adds up to', async () => {
			fetchEarningsFeed.mockResolvedValue([{ id: 'e1', amount: 10 }])
			countEarningsFeed.mockResolvedValue(41)
			const res = await service.getEarnings('s1', { page: 3, limit: 20 }, 'market-1')
			expect(fetchEarningsFeed).toHaveBeenCalledWith(prisma, 's1', 40, 20)
			expect(res.entries.meta).toEqual({ page: 3, limit: 20, total: 41, totalPages: 3 })
			expect(res.balance.balance).toBe(100)
		})
	})

	describe('listCredits', () => {
		it('marks cancelled payouts and hides the join', async () => {
			prisma.sellerCredit.findMany.mockResolvedValue([
				{ id: 'c1', amount: 50, reversal: { id: 'c2' } },
				{ id: 'c2', amount: -50, reversal: null },
				{ id: 'c3', amount: 20, reversal: null }
			])
			prisma.sellerCredit.count.mockResolvedValue(3)
			const res: any = await service.listCredits('s1', {}, 'market-1')
			expect(res.data.map((c: any) => [c.id, c.isReversed])).toEqual([
				['c1', true],
				['c2', false],
				['c3', false]
			])
			expect(res.data[0]).not.toHaveProperty('reversal')
		})
	})
})
