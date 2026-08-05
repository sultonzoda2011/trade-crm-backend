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
				discount: 0,
				totalPrice: 200
			})
			expect(tx.product.updateMany).toHaveBeenCalledTimes(2)
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
					totalPrice: 200
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
				refund: { id: 'refund-1' }
			})
			await expect(
				service.refund('sale-1', ownerUser)
			).rejects.toThrow('already refunded')
		})

		it('restores stock, creates REFUND linked to original, marks original REFUNDED', async () => {
			prisma.transaction.findUnique.mockResolvedValue(paidSale)
			const tx = {
				product: { update: jest.fn().mockResolvedValue({}) },
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
	})
})