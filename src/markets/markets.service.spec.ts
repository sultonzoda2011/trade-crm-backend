import { NotFoundException } from '@nestjs/common'
import { MarketsService } from './markets.service'

describe('MarketsService (IDOR scoping)', () => {
	let service: MarketsService
	let prisma: any
	let storageService: any

	const ownerRow = {
		id: 'owner-1',
		name: 'Owner',
		email: 'owner@x.com',
		image: null,
		role: 'OWNER'
	}

	const marketRow = {
		id: 'market-1',
		name: 'Central Market',
		address: 'Main St 1',
		ownerId: 'owner-1',
		image: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		users: [],
		_count: { products: 0, debtors: 0, transactions: 0 }
	}

	beforeEach(() => {
		prisma = {
			market: {
				findUnique: jest.fn(),
				update: jest.fn(),
				delete: jest.fn()
			},
			user: {
				findUnique: jest.fn(),
				update: jest.fn()
			},
			$transaction: jest.fn((fn: any) => fn(prisma))
		}
		storageService = {
			save: jest.fn(),
			delete: jest.fn()
		}
		prisma.market.findUnique.mockImplementation(({ where }: any) =>
			Promise.resolve({ ...marketRow, id: where.id })
		)
		prisma.user.findUnique.mockResolvedValue(ownerRow)
		prisma.market.update.mockImplementation(({ data }: any) =>
			Promise.resolve({ ...marketRow, ...data })
		)

		service = new MarketsService(prisma, storageService)
	})

	describe('update', () => {
		it('lets an OWNER update their own market', async () => {
			const result = await service.update('market-1', { name: 'New Name' }, undefined as any, 'market-1')

			expect(prisma.market.update).toHaveBeenCalled()
			expect(result.name).toBe('New Name')
		})

		it('blocks an OWNER from updating another market (IDOR)', async () => {
			await expect(
				service.update('market-2', { name: 'Hacked' }, undefined as any, 'market-1')
			).rejects.toThrow(NotFoundException)
			expect(prisma.market.update).not.toHaveBeenCalled()
		})

		it('lets an ADMIN update any market (no scope)', async () => {
			const result = await service.update('market-2', { name: 'Admin Edit' }, undefined as any)

			expect(prisma.market.update).toHaveBeenCalled()
			expect(result.name).toBe('Admin Edit')
		})
	})

	describe('remove', () => {
		it('blocks an OWNER from deleting another market (IDOR)', async () => {
			await expect(
				service.remove('market-2', 'market-1')
			).rejects.toThrow(NotFoundException)
			expect(prisma.market.delete).not.toHaveBeenCalled()
		})

		it('lets an ADMIN delete any market (no scope)', async () => {
			await service.remove('market-2')

			expect(prisma.market.delete).toHaveBeenCalledWith({ where: { id: 'market-2' } })
		})
	})
})
