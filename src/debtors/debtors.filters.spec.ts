import { DebtorsService } from './debtors.service'

describe('DebtorsService.findAll — фильтры по долгам', () => {
	let service: DebtorsService
	let prisma: any

	beforeEach(() => {
		prisma = {
			debtor: {
				findMany: jest.fn().mockResolvedValue([]),
				count: jest.fn().mockResolvedValue(0)
			},
			$queryRaw: jest.fn().mockResolvedValue([])
		}
		service = new DebtorsService(prisma, {} as any)
	})

	const whereOf = () => prisma.debtor.findMany.mock.calls[0][0].where

	it('hasActiveDebts=true → some активного долга', async () => {
		await service.findAll({ hasActiveDebts: true } as any)
		const [cond] = whereOf().AND
		expect(cond.transactions.some).toMatchObject({ type: 'DEBT' })
		expect(cond.transactions.none).toBeUndefined()
	})

	it('hasActiveDebts=false → none активного долга', async () => {
		await service.findAll({ hasActiveDebts: false } as any)
		const [cond] = whereOf().AND
		expect(cond.transactions.none).toMatchObject({ type: 'DEBT' })
		expect(cond.transactions.some).toBeUndefined()
	})

	it('overdue=true → some просроченного долга (dueDate < now)', async () => {
		await service.findAll({ overdue: true } as any)
		const [cond] = whereOf().AND
		expect(cond.transactions.some.dueDate.lt).toBeInstanceOf(Date)
	})

	it('overdue=false больше не игнорируется → none просроченного долга', async () => {
		await service.findAll({ overdue: false } as any)
		const [cond] = whereOf().AND
		expect(cond.transactions.none.dueDate.lt).toBeInstanceOf(Date)
	})

	it('hasActiveDebts и overdue вместе не затирают друг друга', async () => {
		await service.findAll({ hasActiveDebts: false, overdue: true } as any)
		const and = whereOf().AND
		expect(and).toHaveLength(2)
		expect(and[0].transactions.none).toBeDefined()
		expect(and[1].transactions.some.dueDate).toBeDefined()
	})

	it('без фильтров по долгам AND не добавляется', async () => {
		await service.findAll({} as any)
		expect(whereOf().AND).toBeUndefined()
	})
})
