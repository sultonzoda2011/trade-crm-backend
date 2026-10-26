import { Test } from '@nestjs/testing'
import { TransactionsService } from './transactions.service'
import { DebtStatusFilter } from '../enums'
import { PrismaService } from '../prisma/prisma.service'

describe('TransactionsService.findAll — фильтры', () => {
	let service: TransactionsService
	let prisma: any

	beforeEach(async () => {
		prisma = {
			transaction: {
				findMany: jest.fn().mockResolvedValue([]),
				count: jest.fn().mockResolvedValue(0)
			}
		}
		const moduleRef = await Test.createTestingModule({
			providers: [TransactionsService, { provide: PrismaService, useValue: prisma }]
		}).compile()
		service = moduleRef.get(TransactionsService)
	})

	const whereOf = () => prisma.transaction.findMany.mock.calls[0][0].where

	it('debtStatus не затирает явно выбранный тип и статус', async () => {
		await service.findAll({
			type: 'SALE',
			status: 'PAID',
			debtStatus: DebtStatusFilter.OVERDUE
		} as any)
		const where = whereOf()
		expect(where.type).toBe('SALE')
		expect(where.status).toBe('PAID')
		// Условия долга лежат в AND: вместе с type=SALE они дают пустую выборку.
		expect(where.AND).toEqual(
			expect.arrayContaining([
				{ type: 'DEBT' },
				{ status: { in: ['ACTIVE', 'PARTIAL'] } },
				{ dueDate: { lt: expect.any(Date) } }
			])
		)
	})

	it('OUTSTANDING: незакрытый долг без условия по сроку', async () => {
		await service.findAll({ debtStatus: DebtStatusFilter.OUTSTANDING } as any)
		expect(whereOf().AND).toEqual([{ type: 'DEBT' }, { status: { in: ['ACTIVE', 'PARTIAL'] } }])
	})

	it('SETTLED: долг со статусом PAID', async () => {
		await service.findAll({ debtStatus: DebtStatusFilter.SETTLED } as any)
		expect(whereOf().AND).toEqual([{ type: 'DEBT' }, { status: 'PAID' }])
	})

	it('DUE_SOON: срок в ближайшем окне', async () => {
		await service.findAll({ debtStatus: DebtStatusFilter.DUE_SOON } as any)
		const due = whereOf().AND.find((c: any) => c.dueDate).dueDate
		expect(due.gte).toBeInstanceOf(Date)
		expect(due.lte.getTime()).toBeGreaterThan(due.gte.getTime())
	})

	it('без debtStatus условий AND нет', async () => {
		await service.findAll({ type: 'DEBT' } as any)
		expect(whereOf().AND).toBeUndefined()
	})
})
