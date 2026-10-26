import { ConflictException, NotFoundException } from '@nestjs/common'
import { MAX_STOCK } from './dto/restock-product.dto'
import { ProductsService } from './products.service'

describe('ProductsService.restock', () => {
	let service: ProductsService
	let prisma: any

	const productRow = {
		id: 'product-1',
		name: 'Apple',
		price: 1.5,
		quantity: 10,
		marketId: 'market-1'
	}

	beforeEach(() => {
		prisma = {
			product: {
				findUnique: jest.fn().mockResolvedValue(productRow),
				updateMany: jest.fn().mockResolvedValue({ count: 1 })
			}
		}
		// StorageService и AnalyticsService метод пополнения не трогает.
		service = new ProductsService(prisma, {} as any, {} as any)
	})

	it('adds to the stock inside the DB instead of overwriting it', async () => {
		const result = await service.restock('product-1', { quantity: 5 }, 'market-1')

		expect(prisma.product.updateMany).toHaveBeenCalledWith({
			where: { id: 'product-1', quantity: { lte: MAX_STOCK - 5 } },
			data: { quantity: { increment: 5 } }
		})
		// Ответ — свежее чтение, а не посчитанное в коде число.
		expect(prisma.product.findUnique).toHaveBeenCalledTimes(2)
		expect(result).toBe(productRow)
	})

	it('lets an ADMIN (no market scope) restock any market', async () => {
		await expect(service.restock('product-1', { quantity: 5 }, undefined)).resolves.toBeDefined()
		expect(prisma.product.updateMany).toHaveBeenCalledTimes(1)
	})

	it("hides another market's product behind 404 and never writes", async () => {
		await expect(service.restock('product-1', { quantity: 5 }, 'market-2')).rejects.toBeInstanceOf(NotFoundException)
		expect(prisma.product.updateMany).not.toHaveBeenCalled()
	})

	it('404s on an unknown product', async () => {
		prisma.product.findUnique.mockResolvedValue(null)

		await expect(service.restock('missing', { quantity: 5 }, 'market-1')).rejects.toBeInstanceOf(NotFoundException)
		expect(prisma.product.updateMany).not.toHaveBeenCalled()
	})

	it('refuses to push the stock past the limit', async () => {
		prisma.product.updateMany.mockResolvedValue({ count: 0 })

		const error = await service.restock('product-1', { quantity: 5 }, 'market-1').catch((e) => e)

		expect(error).toBeInstanceOf(ConflictException)
		expect(error.getResponse()).toMatchObject({ code: 'PRODUCT_STOCK_LIMIT' })
	})

	it('answers 404, not "limit", when the product was deleted during the update', async () => {
		prisma.product.updateMany.mockResolvedValue({ count: 0 })
		prisma.product.findUnique.mockResolvedValueOnce(productRow).mockResolvedValueOnce(null)

		await expect(service.restock('product-1', { quantity: 5 }, 'market-1')).rejects.toBeInstanceOf(NotFoundException)
	})
})
