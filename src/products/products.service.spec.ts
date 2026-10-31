import {
	BadRequestException,
	ConflictException,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { MAX_STOCK } from './dto/restock-product.dto'
import { ProductsService } from './products.service'
import { WriteOffReason } from '../enums'

const marketId = 'market-1'
const userId = 'user-1'

describe('ProductsService', () => {
	let service: ProductsService
	let prisma: any
	let tx: any

	const productRow = {
		id: 'product-1',
		name: 'Apple',
		price: 1.5,
		quantity: 10,
		marketId,
		isActive: true
	}

	beforeEach(() => {
		tx = {
			product: {
				create: jest.fn(),
				updateMany: jest.fn().mockResolvedValue({ count: 1 }),
				findUniqueOrThrow: jest.fn().mockResolvedValue({ quantity: 15 })
			},
			stockMovement: { create: jest.fn().mockResolvedValue({}) }
		}
		prisma = {
			$transaction: jest.fn((cb: any) => cb(tx)),
			$queryRaw: jest.fn(),
			$executeRaw: jest.fn(),
			product: {
				findUnique: jest.fn().mockResolvedValue(productRow),
				update: jest.fn(),
				count: jest.fn(),
				delete: jest.fn()
			},
			transactionItem: { count: jest.fn().mockResolvedValue(0) },
			category: { count: jest.fn().mockResolvedValue(1) },
			stockMovement: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) }
		}
		// StorageService и AnalyticsService эти методы не трогают.
		service = new ProductsService(prisma, { delete: jest.fn() } as any, {} as any)
	})

	describe('create', () => {
		it('writes the opening balance into the journal', async () => {
			tx.product.create.mockResolvedValue({ ...productRow, quantity: 7 })

			await service.create({ name: 'Apple', price: 1.5, quantity: 7 } as any, undefined as any, marketId, userId)

			expect(tx.stockMovement.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					productId: 'product-1',
					marketId,
					type: 'OPENING',
					delta: 7,
					balanceAfter: 7,
					createdById: userId
				})
			})
		})

		it('does not log an empty opening balance', async () => {
			tx.product.create.mockResolvedValue({ ...productRow, quantity: 0 })

			await service.create({ name: 'Apple', price: 1.5, quantity: 0 } as any, undefined as any, marketId, userId)

			expect(tx.stockMovement.create).not.toHaveBeenCalled()
		})

		it('requires a market', async () => {
			await expect(service.create({} as any, undefined as any, undefined)).rejects.toBeInstanceOf(
				UnauthorizedException
			)
		})
	})

	describe('restock', () => {
		it('adds to the stock inside the DB and journals RESTOCK with the balance after', async () => {
			const result = await service.restock('product-1', { quantity: 5, note: ' поставка ' }, marketId, userId)

			expect(tx.product.updateMany).toHaveBeenCalledWith({
				where: { id: 'product-1', quantity: { lte: MAX_STOCK - 5 } },
				data: { quantity: { increment: 5 } }
			})
			expect(tx.stockMovement.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					type: 'RESTOCK',
					delta: 5,
					balanceAfter: 15,
					note: 'поставка',
					createdById: userId
				})
			})
			// Ответ — свежее чтение, а не посчитанное в коде число.
			expect(prisma.product.findUnique).toHaveBeenCalledTimes(2)
			expect(result).toBe(productRow)
		})

		it('lets an ADMIN (no market scope) restock any market', async () => {
			await expect(service.restock('product-1', { quantity: 5 }, undefined)).resolves.toBeDefined()
			expect(tx.product.updateMany).toHaveBeenCalledTimes(1)
		})

		it("hides another market's product behind 404 and never writes", async () => {
			await expect(service.restock('product-1', { quantity: 5 }, 'market-2')).rejects.toBeInstanceOf(
				NotFoundException
			)
			expect(prisma.$transaction).not.toHaveBeenCalled()
		})

		it('404s on an unknown product', async () => {
			prisma.product.findUnique.mockResolvedValue(null)

			await expect(service.restock('missing', { quantity: 5 }, marketId)).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.$transaction).not.toHaveBeenCalled()
		})

		it('refuses to push the stock past the limit and journals nothing', async () => {
			tx.product.updateMany.mockResolvedValue({ count: 0 })

			const error = await service.restock('product-1', { quantity: 5 }, marketId).catch(e => e)

			expect(error).toBeInstanceOf(ConflictException)
			expect(error.getResponse()).toMatchObject({ code: 'PRODUCT_STOCK_LIMIT' })
			expect(tx.stockMovement.create).not.toHaveBeenCalled()
		})

		it('answers 404, not "limit", when the product was deleted during the update', async () => {
			tx.product.updateMany.mockResolvedValue({ count: 0 })
			prisma.product.findUnique.mockResolvedValueOnce(productRow).mockResolvedValueOnce(null)

			await expect(service.restock('product-1', { quantity: 5 }, marketId)).rejects.toBeInstanceOf(
				NotFoundException
			)
		})
	})

	describe('writeOff', () => {
		const dto = { quantity: 3, reason: WriteOffReason.DAMAGED }

		it('decrements atomically and journals WRITE_OFF with the reason', async () => {
			tx.product.findUniqueOrThrow.mockResolvedValue({ quantity: 7 })

			await service.writeOff('product-1', dto, marketId, userId)

			expect(tx.product.updateMany).toHaveBeenCalledWith({
				where: { id: 'product-1', quantity: { gte: 3 } },
				data: { quantity: { increment: -3 } }
			})
			expect(tx.stockMovement.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					type: 'WRITE_OFF',
					delta: -3,
					balanceAfter: 7,
					reason: 'DAMAGED',
					createdById: userId
				})
			})
		})

		it('cannot take the stock below zero and tells how much is left', async () => {
			tx.product.updateMany.mockResolvedValue({ count: 0 })

			const error = await service.writeOff('product-1', { ...dto, quantity: 99 }, marketId).catch(e => e)

			expect(error).toBeInstanceOf(BadRequestException)
			expect(error.getResponse()).toMatchObject({
				code: 'PRODUCT_NOT_ENOUGH_STOCK',
				details: { available: 10 }
			})
			expect(tx.stockMovement.create).not.toHaveBeenCalled()
		})

		it("does not touch another market's product", async () => {
			await expect(service.writeOff('product-1', dto, 'market-2')).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.$transaction).not.toHaveBeenCalled()
		})
	})

	describe('adjust (inventory count)', () => {
		it('sets the counted total and journals the difference', async () => {
			await service.adjust('product-1', { quantity: 4, note: 'Инвентаризация' }, marketId, userId)

			// Условие quantity: 10 — запись только если остаток не менялся с момента чтения.
			expect(tx.product.updateMany).toHaveBeenCalledWith({
				where: { id: 'product-1', quantity: 10 },
				data: { quantity: 4 }
			})
			expect(tx.stockMovement.create).toHaveBeenCalledWith({
				data: expect.objectContaining({ type: 'ADJUSTMENT', delta: -6, balanceAfter: 4 })
			})
		})

		it('does nothing when the count matches the books', async () => {
			const result = await service.adjust('product-1', { quantity: 10 }, marketId, userId)

			expect(result).toBe(productRow)
			expect(prisma.$transaction).not.toHaveBeenCalled()
		})

		it('refuses to overwrite a stock that changed while counting', async () => {
			tx.product.updateMany.mockResolvedValue({ count: 0 })
			prisma.product.findUnique.mockResolvedValueOnce(productRow).mockResolvedValueOnce({ ...productRow, quantity: 8 })

			const error = await service.adjust('product-1', { quantity: 4 }, marketId).catch(e => e)

			expect(error).toBeInstanceOf(ConflictException)
			expect(error.getResponse()).toMatchObject({
				code: 'PRODUCT_STOCK_CHANGED',
				details: { currentQuantity: 8 }
			})
			expect(tx.stockMovement.create).not.toHaveBeenCalled()
		})
	})

	describe('archive', () => {
		it('archives with a timestamp', async () => {
			await service.setArchived('product-1', true, marketId)

			expect(prisma.product.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: 'product-1' },
					data: { isActive: false, archivedAt: expect.any(Date) }
				})
			)
		})

		it('restores from the archive and clears the timestamp', async () => {
			prisma.product.findUnique.mockResolvedValue({ ...productRow, isActive: false })

			await service.setArchived('product-1', false, marketId)

			expect(prisma.product.update).toHaveBeenCalledWith(
				expect.objectContaining({ data: { isActive: true, archivedAt: null } })
			)
		})

		it('is idempotent: archiving an archived product writes nothing', async () => {
			prisma.product.findUnique.mockResolvedValue({ ...productRow, isActive: false })

			await service.setArchived('product-1', true, marketId)

			expect(prisma.product.update).not.toHaveBeenCalled()
		})
	})

	describe('remove', () => {
		it('points to the archive when the product has sales history', async () => {
			prisma.transactionItem.count.mockResolvedValue(3)

			const error = await service.remove('product-1', marketId).catch(e => e)

			expect(error).toBeInstanceOf(ConflictException)
			expect(error.getResponse()).toMatchObject({
				code: 'PRODUCT_HAS_TRANSACTIONS',
				details: { transactionItemsCount: 3, canArchive: true }
			})
			expect(prisma.product.delete).not.toHaveBeenCalled()
		})

		it('deletes a product without history', async () => {
			await service.remove('product-1', marketId)
			expect(prisma.product.delete).toHaveBeenCalledWith({ where: { id: 'product-1' } })
		})
	})

	describe('findMovements', () => {
		it('scopes the journal to the product, newest first, with a type filter', async () => {
			await service.findMovements('product-1', { type: 'SALE', page: 1, limit: 20 } as any, marketId)

			expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { productId: 'product-1', type: 'SALE' },
					orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
				})
			)
		})

		it("does not leak another market's journal", async () => {
			await expect(service.findMovements('product-1', {} as any, 'market-2')).rejects.toBeInstanceOf(
				NotFoundException
			)
			expect(prisma.stockMovement.findMany).not.toHaveBeenCalled()
		})
	})

	describe('summary', () => {
		it('returns the aggregate row from a single query', async () => {
			const row = {
				activeProducts: 20,
				archivedProducts: 2,
				outOfStock: 1,
				lowStock: 3,
				stockRetailValue: 1000,
				stockCostValue: 700,
				potentialProfit: 300,
				productsWithoutCost: 2
			}
			prisma.$queryRaw.mockResolvedValue([row])

			await expect(service.summary(marketId)).resolves.toEqual(row)
			expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
		})
	})

	describe('bulkPrice', () => {
		it('needs a market (an ADMIN without one cannot reprice everything)', async () => {
			await expect(service.bulkPrice({ percent: 5 } as any, undefined)).rejects.toBeInstanceOf(BadRequestException)
			expect(prisma.$executeRaw).not.toHaveBeenCalled()
		})

		it('rejects a zero change', async () => {
			await expect(service.bulkPrice({ percent: 0 } as any, marketId)).rejects.toBeInstanceOf(BadRequestException)
		})

		it('404s on a category from another market', async () => {
			prisma.category.count.mockResolvedValue(0)

			await expect(
				service.bulkPrice({ percent: 5, categoryId: 'cat-x' } as any, marketId)
			).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.category.count).toHaveBeenCalledWith({ where: { id: 'cat-x', marketId } })
			expect(prisma.$executeRaw).not.toHaveBeenCalled()
		})

		it('dry run previews up to 20 rows and writes nothing', async () => {
			const rows = Array.from({ length: 25 }, (_, i) => ({
				id: `p${i}`,
				name: `P${i}`,
				oldPrice: 100,
				newPrice: 105
			}))
			prisma.$queryRaw.mockResolvedValue(rows)

			const result = await service.bulkPrice({ percent: 5, dryRun: true } as any, marketId)

			expect(result).toMatchObject({ dryRun: true, count: 25 })
			expect(result.items).toHaveLength(20)
			expect(prisma.$executeRaw).not.toHaveBeenCalled()
		})

		it('applies the change in a single UPDATE and reports the count', async () => {
			prisma.$executeRaw.mockResolvedValue(12)

			await expect(service.bulkPrice({ percent: -10, roundTo: 100 } as any, marketId)).resolves.toEqual({
				dryRun: false,
				count: 12,
				items: []
			})
			expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
		})
	})
})
