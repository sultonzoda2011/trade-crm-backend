import { Test } from '@nestjs/testing'
import {
	BadRequestException,
	ForbiddenException,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { TransactionsService } from './transactions.service'
import { TransactionType } from '../enums'
import { Role, TransactionStatus } from '../enums'
import { JwtPayload } from '../interfaces'
import { PrismaService } from '../prisma/prisma.service'

const marketId = 'market-1'

const ownerUser: JwtPayload = {
	sub: 'user-1',
	id: 'user-1',
	email: 'owner@x.com',
	role: Role.OWNER,
	name: 'Owner',
	marketId
}

const sellerUser: JwtPayload = {
	sub: 'user-2',
	id: 'user-2',
	email: 'seller@x.com',
	role: Role.SELLER,
	name: 'Seller',
	marketId
}

describe('TransactionsService', () => {
	let service: TransactionsService
	let prisma: any

	beforeEach(async () => {
		prisma = {
			$transaction: jest.fn(),
			debtor: { findUnique: jest.fn() },
			product: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
			transaction: {
				findUnique: jest.fn(),
				findMany: jest.fn(),
				count: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
				create: jest.fn(),
				delete: jest.fn(),
				findUniqueOrThrow: jest.fn()
			},
			transactionItem: { findMany: jest.fn() },
			payment: { create: jest.fn() }
		}

		const moduleRef = await Test.createTestingModule({
			providers: [
				TransactionsService,
				{ provide: PrismaService, useValue: prisma }
			]
		}).compile()

		service = moduleRef.get(TransactionsService)
	})

	describe('create', () => {
		it('throws if user has no market', async () => {
			await expect(
				service.create({} as any, { ...sellerUser, marketId: undefined })
			).rejects.toThrow(UnauthorizedException)
		})

		it('throws Forbidden if SELLER creates a non-DEBT transaction', async () => {
			await expect(
				service.create({ type: TransactionType.SALE } as any, sellerUser)
			).rejects.toThrow(ForbiddenException)
		})

		it('throws BadRequest if DEBT has no debtorId', async () => {
			await expect(
				service.create(
					{ type: TransactionType.DEBT, items: [], paymentType: 'CASH' } as any,
					ownerUser
				)
			).rejects.toThrow(BadRequestException)
		})

		it('rejects debtor from another market (IDOR protection)', async () => {
			prisma.$transaction.mockImplementation((cb: any) =>
				cb({
					debtor: {
						findUnique: jest.fn().mockResolvedValue({ marketId: 'other-market' })
					}
				})
			)

			await expect(
				service.create(
					{
						type: TransactionType.DEBT,
						debtorId: 'debtor-1',
						items: [],
						paymentType: 'CASH'
					} as any,
					ownerUser
				)
			).rejects.toThrow('Debtor was not found in your market')
		})

		it('rejects when product quantity is insufficient', async () => {
prisma.$transaction.mockImplementation((cb: any) =>
			cb({
				debtor: { findUnique: jest.fn().mockResolvedValue({ marketId }) },
					product: {
						findMany: jest.fn().mockResolvedValue([
							{
								id: 'p1',
								name: 'Milk',
								price: 100,
								quantity: 1,
								categoryId: null
							}
						]),
						updateMany: jest.fn().mockResolvedValue({ count: 0 })
					},
					transaction: { create: jest.fn() }
				})
			)

			await expect(
				service.create(
					{
						type: TransactionType.SALE,
						items: [{ productId: 'p1', quantity: 5 }],
						paymentType: 'CASH'
					} as any,
					ownerUser
				)
			).rejects.toThrow('Not enough stock')
		})

		it('computes totals from DB price and decrements stock atomically', async () => {
			const tx = {
				debtor: { findUnique: jest.fn().mockResolvedValue({ marketId }) },
				product: {
					findMany: jest.fn().mockResolvedValue([
						{
							id: 'p1',
							name: 'Milk',
							price: 100,
							quantity: 10,
							categoryId: null
						},
						{
							id: 'p2',
							name: 'Bread',
							price: 50,
							quantity: 10,
							categoryId: null
						}
					]),
					updateMany: jest.fn().mockResolvedValue({ count: 1 })
				},
				transaction: {
					create: jest
						.fn()
						.mockResolvedValue({
							id: 'tx1',
							totalAmount: 250,
							discountAmount: 50
						})
				}
			}
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.create(
				{
					type: TransactionType.SALE,
					items: [
						{ productId: 'p1', quantity: 2 },
						{ productId: 'p2', quantity: 1, discount: 50 }
					],
					paymentType: 'CASH'
				} as any,
				ownerUser
			)

			expect(tx.transaction.create).toHaveBeenCalled()
			const data = tx.transaction.create.mock.calls[0][0].data
			expect(data.totalAmount).toBe(200)
			expect(data.discountAmount).toBe(50)
			expect(data.status).toBe(TransactionStatus.PAID)
			expect(data.remainingAmount).toBe(0)
			expect(data.items.create).toHaveLength(2)
			expect(data.items.create[0]).toEqual({
				productId: 'p1',
				productName: 'Milk',
				quantity: 2,
				price: 100,
				costPrice: null,
				discount: 0,
				markup: 0,
				totalPrice: 200
			})
			expect(tx.product.updateMany).toHaveBeenCalledTimes(2)
		})

		it('ignores debtorId on a SALE and stores no debtor', async () => {
			const tx = {
				debtor: { findUnique: jest.fn().mockResolvedValue({ marketId }) },
				product: {
					findMany: jest.fn().mockResolvedValue([
						{
							id: 'p1',
							name: 'Milk',
							price: 100,
							quantity: 10,
							categoryId: null
						}
					]),
					updateMany: jest.fn().mockResolvedValue({ count: 1 })
				},
				transaction: { create: jest.fn().mockResolvedValue({ id: 'tx1' }) }
			}
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.create(
				{
					type: TransactionType.SALE,
					debtorId: 'debtor-1',
					items: [{ productId: 'p1', quantity: 1 }],
					paymentType: 'CASH'
				} as any,
				ownerUser
			)

			const data = tx.transaction.create.mock.calls[0][0].data
			expect(data.debtorId).toBeNull()
			expect(tx.debtor.findUnique).not.toHaveBeenCalled()
		})

		it('persists customerName on a SALE', async () => {
			const tx = {
				debtor: { findUnique: jest.fn() },
				product: {
					findMany: jest.fn().mockResolvedValue([
						{
							id: 'p1',
							name: 'Milk',
							price: 100,
							quantity: 10,
							categoryId: null
						}
					]),
					updateMany: jest.fn().mockResolvedValue({ count: 1 })
				},
				transaction: { create: jest.fn().mockResolvedValue({ id: 'tx1' }) }
			}
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.create(
				{
					type: TransactionType.SALE,
					customerName: 'Иван',
					items: [{ productId: 'p1', quantity: 1 }],
					paymentType: 'CASH'
				} as any,
				ownerUser
			)

			const data = tx.transaction.create.mock.calls[0][0].data
			expect(data.customerName).toBe('Иван')
			expect(data.debtorId).toBeNull()
		})

		it('does not persist customerName on a DEBT', async () => {
			const tx = {
				debtor: { findUnique: jest.fn().mockResolvedValue({ marketId }) },
				product: {
					findMany: jest.fn().mockResolvedValue([
						{
							id: 'p1',
							name: 'Milk',
							price: 100,
							quantity: 10,
							categoryId: null
						}
					]),
					updateMany: jest.fn().mockResolvedValue({ count: 1 })
				},
				transaction: { create: jest.fn().mockResolvedValue({ id: 'tx1' }) }
			}
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.create(
				{
					type: TransactionType.DEBT,
					debtorId: 'debtor-1',
					customerName: 'Иван',
					items: [{ productId: 'p1', quantity: 1 }],
					paymentType: 'CREDIT'
				} as any,
				ownerUser
			)

			const data = tx.transaction.create.mock.calls[0][0].data
			expect(data.customerName).toBeNull()
			expect(data.debtorId).toBe('debtor-1')
		})
	})

	describe('update', () => {
		it('rejects updating debtor that belongs to another market', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				id: 'tx1',
				marketId
			})
			prisma.debtor.findUnique.mockResolvedValue({ marketId: 'other-market' })

			await expect(
				service.update('tx1', { debtorId: 'd1' } as any, marketId)
			).rejects.toThrow('Debtor was not found in your market')
		})
	})

	describe('pay', () => {
		it('throws if transaction already fully paid', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				id: 'tx1',
				marketId,
				remainingAmount: 0
			})

			await expect(
				service.pay('tx1', { amount: 10 } as any, ownerUser)
			).rejects.toThrow('already fully paid')
		})

		it('throws if payment exceeds remaining amount', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				id: 'tx1',
				marketId,
				remainingAmount: 50
			})

			await expect(
				service.pay('tx1', { amount: 100 } as any, ownerUser)
			).rejects.toThrow('exceeds remaining debt')
		})
	})

	describe('refund', () => {
		const paidSale = {
			id: 'sale-1',
			marketId,
			type: TransactionType.SALE,
			status: TransactionStatus.PAID,
			totalAmount: 200,
			paymentType: 'CASH',
			debtorId: null,
			refund: null,
			items: [
				{
					id: 'i1',
					productId: 'p1',
					productName: 'Milk',
					quantity: 2,
					price: 100,
					discount: 0,
					totalPrice: 200,
					refundedQuantity: 0
				}
			]
		}

		it('throws if transaction belongs to another market', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				...paidSale,
				marketId: 'other-market'
			})
			await expect(
				service.refund('sale-1', ownerUser)
			).rejects.toThrow(NotFoundException)
		})

		it('throws if transaction is a REFUND', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				...paidSale,
				type: TransactionType.REFUND
			})
			await expect(
				service.refund('sale-1', ownerUser)
			).rejects.toThrow('Cannot refund a refund')
		})

		it('throws if transaction is not a SALE', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				...paidSale,
				type: TransactionType.DEBT
			})
			await expect(
				service.refund('sale-1', ownerUser)
			).rejects.toThrow('Only SALE transactions')
		})

		it('throws if SALE is not fully paid', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				...paidSale,
				status: TransactionStatus.ACTIVE
			})
			await expect(
				service.refund('sale-1', ownerUser)
			).rejects.toThrow('fully paid')
		})

		it('throws if already refunded', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				...paidSale,
				items: [{ ...paidSale.items[0], refundedQuantity: 2 }]
			})
			await expect(
				service.refund('sale-1', ownerUser)
			).rejects.toThrow('already refunded')
		})

		it('restores stock, creates REFUND linked to original, marks original REFUNDED', async () => {
			prisma.transaction.findUnique.mockResolvedValue(paidSale)
			const tx = {
				product: { update: jest.fn().mockResolvedValue({}) },
				transactionItem: {
					updateMany: jest.fn().mockResolvedValue({ count: 1 })
				},
				transaction: {
					create: jest
						.fn()
						.mockResolvedValue({
							id: 'refund-1',
							refundOfId: 'sale-1'
						}),
					update: jest.fn().mockResolvedValue({})
				}
			}
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			const result = await service.refund('sale-1', ownerUser)

			expect(tx.product.update).toHaveBeenCalledWith({
				where: { id: 'p1' },
				data: { quantity: { increment: 2 } }
			})
			const data = tx.transaction.create.mock.calls[0][0].data
			expect(data.type).toBe(TransactionType.REFUND)
			expect(data.refundOfId).toBe('sale-1')
			expect(data.status).toBe(TransactionStatus.PAID)
			expect(data.remainingAmount).toBe(0)
			expect(tx.transaction.update).toHaveBeenCalledWith({
				where: { id: 'sale-1' },
				data: { status: TransactionStatus.REFUNDED }
			})
			expect(result.refundOfId).toBe('sale-1')
		})

		it('stores the reason in note and copies the cost snapshot to the refund lines', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				...paidSale,
				items: [{ ...paidSale.items[0], costPrice: 60 }]
			})
			const tx = {
				product: { update: jest.fn().mockResolvedValue({}) },
				transactionItem: {
					updateMany: jest.fn().mockResolvedValue({ count: 1 })
				},
				transaction: {
					create: jest.fn().mockResolvedValue({ id: 'refund-1' }),
					update: jest.fn().mockResolvedValue({})
				}
			}
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.refund('sale-1', ownerUser, { reason: '  Брак  ' })

			const data = tx.transaction.create.mock.calls[0][0].data
			expect(data.note).toBe('Брак')
			expect(data.items.create[0].costPrice).toBe(60)
		})
	})

	describe('create: advance, note, cost snapshot', () => {
		const milk = {
			id: 'p1',
			name: 'Milk',
			price: 100,
			costPrice: 60,
			quantity: 10,
			categoryId: null
		}

		const makeTx = () => ({
			debtor: { findUnique: jest.fn().mockResolvedValue({ marketId }) },
			product: {
				findMany: jest.fn().mockResolvedValue([milk]),
				updateMany: jest.fn().mockResolvedValue({ count: 1 })
			},
			transaction: { create: jest.fn().mockResolvedValue({ id: 'tx1' }) }
		})

		const debtDto = (extra: Record<string, unknown> = {}) =>
			({
				type: TransactionType.DEBT,
				debtorId: 'debtor-1',
				paymentType: 'CREDIT',
				items: [{ productId: 'p1', quantity: 2 }],
				...extra
			}) as any

		it('records an advance as a Payment and leaves the rest as PARTIAL debt', async () => {
			const tx = makeTx()
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.create(debtDto({ paidAmount: 50 }), sellerUser)

			const data = tx.transaction.create.mock.calls[0][0].data
			expect(data.totalAmount).toBe(200)
			expect(data.remainingAmount).toBe(150)
			expect(data.status).toBe(TransactionStatus.PARTIAL)
			expect(data.payments).toEqual({
				create: { amount: 50, createdById: sellerUser.sub }
			})
		})

		it('without an advance the debt is ACTIVE and no Payment is created', async () => {
			const tx = makeTx()
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.create(debtDto(), ownerUser)

			const data = tx.transaction.create.mock.calls[0][0].data
			expect(data.remainingAmount).toBe(200)
			expect(data.status).toBe(TransactionStatus.ACTIVE)
			expect(data.payments).toBeUndefined()
		})

		it('rejects an advance that covers the whole total', async () => {
			const tx = makeTx()
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await expect(
				service.create(debtDto({ paidAmount: 200 }), ownerUser)
			).rejects.toThrow('Advance payment must be less than the total')
			expect(tx.transaction.create).not.toHaveBeenCalled()
		})

		it('rejects an advance on a SALE', async () => {
			await expect(
				service.create(
					{
						type: TransactionType.SALE,
						paymentType: 'CASH',
						paidAmount: 10,
						items: [{ productId: 'p1', quantity: 1 }]
					} as any,
					ownerUser
				)
			).rejects.toThrow('only allowed for DEBT')
		})

		it('trims the note and snapshots the purchase price on each line', async () => {
			const tx = makeTx()
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.create(
				{
					type: TransactionType.SALE,
					paymentType: 'CASH',
					note: '  заберёт завтра ',
					items: [{ productId: 'p1', quantity: 1 }]
				} as any,
				ownerUser
			)

			const data = tx.transaction.create.mock.calls[0][0].data
			expect(data.note).toBe('заберёт завтра')
			expect(data.items.create[0].costPrice).toBe(60)
		})
	})

	describe('update: note on a finalized transaction', () => {
		it('allows editing only the note of a PAID transaction', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				id: 'tx1',
				marketId,
				status: TransactionStatus.PAID
			})
			prisma.transaction.update.mockResolvedValue({ id: 'tx1' })

			await service.update('tx1', { note: 'ok' } as any, marketId)

			expect(prisma.transaction.update).toHaveBeenCalled()
		})

		it('still blocks other edits of a PAID transaction', async () => {
			prisma.transaction.findUnique.mockResolvedValue({
				id: 'tx1',
				marketId,
				status: TransactionStatus.PAID
			})

			await expect(
				service.update('tx1', { dueDate: '2026-12-01', note: 'x' } as any, marketId)
			).rejects.toThrow('finalized')
		})
	})

	describe('remove: seller cancellation', () => {
		const debt = (overrides: Record<string, unknown> = {}) => ({
			id: 'debt-1',
			marketId,
			type: TransactionType.DEBT,
			status: TransactionStatus.ACTIVE,
			createdById: sellerUser.sub,
			createdAt: new Date(Date.now() - 60 * 1000),
			...overrides
		})

		beforeEach(() => {
			prisma.payment.count = jest.fn().mockResolvedValue(0)
			prisma.transaction.count.mockResolvedValue(0)
		})

		it("rejects cancelling another seller's transaction", async () => {
			prisma.transaction.findUnique.mockResolvedValue(
				debt({ createdById: 'someone-else' })
			)
			await expect(
				service.remove('debt-1', marketId, sellerUser)
			).rejects.toThrow('their own')
		})

		it('rejects cancelling after the 10 minute window', async () => {
			prisma.transaction.findUnique.mockResolvedValue(
				debt({ createdAt: new Date(Date.now() - 11 * 60 * 1000) })
			)
			await expect(
				service.remove('debt-1', marketId, sellerUser)
			).rejects.toThrow('within 10 minutes')
		})

		it('rejects cancelling a transaction that already has payments', async () => {
			prisma.transaction.findUnique.mockResolvedValue(debt())
			prisma.payment.count.mockResolvedValue(1)
			await expect(
				service.remove('debt-1', marketId, sellerUser)
			).rejects.toThrow('with payments')
		})

		it('lets a seller cancel their own fresh debt and returns the stock', async () => {
			prisma.transaction.findUnique.mockResolvedValue(debt())
			const tx = {
				transactionItem: {
					findMany: jest
						.fn()
						.mockResolvedValue([{ productId: 'p1', quantity: 2, refundOfItemId: null }])
				},
				product: { update: jest.fn().mockResolvedValue({}) },
				transaction: { delete: jest.fn().mockResolvedValue({}) }
			}
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.remove('debt-1', marketId, sellerUser)

			expect(tx.product.update).toHaveBeenCalledWith({
				where: { id: 'p1' },
				data: { quantity: { increment: 2 } }
			})
			expect(tx.transaction.delete).toHaveBeenCalledWith({
				where: { id: 'debt-1' }
			})
		})

		it('does not apply seller limits to an owner', async () => {
			prisma.transaction.findUnique.mockResolvedValue(
				debt({ createdById: 'someone-else', createdAt: new Date(0) })
			)
			const tx = {
				transactionItem: { findMany: jest.fn().mockResolvedValue([]) },
				product: { update: jest.fn() },
				transaction: { delete: jest.fn().mockResolvedValue({}) }
			}
			prisma.$transaction.mockImplementation((cb: any) => cb(tx))

			await service.remove('debt-1', marketId, ownerUser)

			expect(tx.transaction.delete).toHaveBeenCalled()
		})
	})

	describe('summary', () => {
		it('aggregates by type with the same market scope and filters as the list', async () => {
			prisma.transaction.groupBy = jest.fn().mockResolvedValue([
				{ type: 'SALE', _count: { _all: 3 }, _sum: { totalAmount: 300, remainingAmount: 0 } },
				{ type: 'DEBT', _count: { _all: 2 }, _sum: { totalAmount: 500, remainingAmount: 320.5 } },
				{ type: 'REFUND', _count: { _all: 1 }, _sum: { totalAmount: 80, remainingAmount: 0 } }
			])

			const result = await service.summary(
				{ createdById: 'user-2' } as any,
				marketId
			)

			expect(prisma.transaction.groupBy).toHaveBeenCalledWith(
				expect.objectContaining({
					by: ['type'],
					where: { marketId, createdById: 'user-2' }
				})
			)
			expect(result).toEqual({
				count: 6,
				sales: { count: 3, amount: 300 },
				debts: { count: 2, amount: 500, remaining: 320.5 },
				refunds: { count: 1, amount: 80 },
				netAmount: 720
			})
		})

		it('returns zeros when nothing matches', async () => {
			prisma.transaction.groupBy = jest.fn().mockResolvedValue([])

			const result = await service.summary({} as any, marketId)

			expect(result.count).toBe(0)
			expect(result.netAmount).toBe(0)
			expect(result.debts.remaining).toBe(0)
		})
	})
})
