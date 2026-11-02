import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { MarketsService } from './markets.service'

describe('MarketsService (IDOR scoping)', () => {
	let service: MarketsService
	let prisma: any
	let storageService: any
	let productsService: any
	let debtorsService: any

	const ownerRow = {
		id: 'owner-1',
		name: 'Owner',
		email: 'owner@x.com',
		image: null,
		role: 'OWNER',
		phone: '+992 900 11-22-33'
	}

	const marketRow = {
		id: 'market-1',
		name: 'Central Market',
		address: 'Main St 1',
		ownerId: 'owner-1',
		image: null,
		phone: null,
		workHours: null,
		allowSellerSales: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		users: [],
		_count: { products: 0, debtors: 0, transactions: 0 }
	}

	beforeEach(() => {
		prisma = {
			market: {
				findUnique: jest.fn(),
				findFirst: jest.fn().mockResolvedValue(null),
				create: jest.fn(),
				update: jest.fn(),
				delete: jest.fn()
			},
			product: { count: jest.fn().mockResolvedValue(12) },
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

		productsService = {
			summary: jest.fn().mockResolvedValue({
				activeProducts: 12,
				outOfStock: 1,
				lowStock: 2,
				stockRetailValue: 5000,
				stockCostValue: 3500,
				productsWithoutCost: 3
			})
		}
		debtorsService = {
			getSummary: jest.fn().mockResolvedValue({ totalDebt: 900, overdueAmount: 300, debtorsWithDebt: 4 })
		}

		service = new MarketsService(prisma, storageService, productsService, debtorsService, {} as any)
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

	describe('findOne', () => {
		const staff = [
			{ id: 'owner-1', name: 'Owner', image: null, email: 'owner@x.com', role: 'OWNER', phone: null },
			{ id: 's1', name: 'Seller', image: null, email: 's1@x.com', role: 'SELLER', phone: '+992 900 00-00-01' }
		]

		beforeEach(() => {
			prisma.market.findUnique.mockImplementation(({ where }: any) =>
				Promise.resolve({ ...marketRow, id: where.id, users: staff })
			)
		})

		it('hides every email from a seller but keeps names and phones', async () => {
			const result: any = await service.findOne('market-1', 'market-1', { hideEmails: true })

			expect(result.owner.email).toBeUndefined()
			expect(result.owner.phone).toBe('+992 900 11-22-33')
			expect(result.users.every((u: any) => u.email === undefined)).toBe(true)
			expect(result.users[1].phone).toBe('+992 900 00-00-01')
		})

		it('keeps emails for owners and admins', async () => {
			const result: any = await service.findOne('market-1', 'market-1')

			expect(result.owner.email).toBe('owner@x.com')
			expect(result.users[0].email).toBe('owner@x.com')
		})

		it("does not show a seller another market (IDOR)", async () => {
			await expect(service.findOne('market-2', 'market-1', { hideEmails: true })).rejects.toThrow(NotFoundException)
		})
	})

	describe('create', () => {
		const dto = { name: 'New market', address: 'Somewhere 12', ownerId: 'owner-9' }

		it('rejects an owner who is not an OWNER before uploading the image', async () => {
			prisma.user.findUnique.mockResolvedValue({ id: 'owner-9', role: 'SELLER' })

			await expect(service.create(dto, { buffer: Buffer.from('x') } as any)).rejects.toMatchObject({
				response: { code: 'MARKET_OWNER_INVALID' }
			})
			expect(storageService.save).not.toHaveBeenCalled()
			expect(prisma.market.create).not.toHaveBeenCalled()
		})

		it('rejects a user who already owns another market', async () => {
			prisma.user.findUnique.mockResolvedValue({ id: 'owner-9', role: 'OWNER' })
			prisma.market.findFirst.mockResolvedValue({ id: 'market-7' })

			await expect(service.create(dto, undefined as any)).rejects.toThrow(ConflictException)
			expect(prisma.market.create).not.toHaveBeenCalled()
		})

		it('requires an owner when the caller is not one', async () => {
			await expect(service.create({ name: 'N', address: 'Address 1' } as any, undefined as any)).rejects.toThrow(
				BadRequestException
			)
		})

		it('stores contacts and clears empty ones', async () => {
			prisma.user.findUnique.mockResolvedValue({ id: 'owner-9', role: 'OWNER' })
			prisma.market.create.mockImplementation(({ data }: any) => Promise.resolve({ ...marketRow, ...data, id: 'new' }))

			await service.create({ ...dto, phone: '+992 900 12-34-56', workHours: '  ' }, undefined as any)

			const data = prisma.market.create.mock.calls[0][0].data
			expect(data.phone).toBe('+992 900 12-34-56')
			expect(data.workHours).toBeNull()
			expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'owner-9' }, data: { marketId: 'new' } })
		})
	})

	describe('update: owner and contacts', () => {
		it('forbids an OWNER to hand the market to someone else', async () => {
			await expect(
				service.update('market-1', { ownerId: 'someone-else' }, undefined as any, 'market-1', false)
			).rejects.toMatchObject({ response: { code: 'MARKET_OWNER_ADMIN_ONLY' } })
			expect(prisma.market.update).not.toHaveBeenCalled()
			expect(prisma.user.update).not.toHaveBeenCalled()
		})

		it('ignores an unchanged ownerId sent back by the form', async () => {
			await service.update('market-1', { name: 'Same owner', ownerId: 'owner-1' }, undefined as any, 'market-1', false)

			expect(prisma.user.update).not.toHaveBeenCalled()
			expect(prisma.market.update.mock.calls[0][0].data).toEqual({ name: 'Same owner' })
		})

		it('lets an ADMIN move the market to another OWNER', async () => {
			prisma.user.findUnique.mockResolvedValue({ id: 'owner-2', role: 'OWNER', name: 'N', email: 'n@x.com', image: null })

			await service.update('market-1', { ownerId: 'owner-2' }, undefined as any, undefined, true)

			expect(prisma.market.findFirst).toHaveBeenCalledWith({
				where: { ownerId: 'owner-2', id: { not: 'market-1' } },
				select: { id: true }
			})
			expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'owner-1' }, data: { marketId: null } })
			expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'owner-2' }, data: { marketId: 'market-1' } })
			expect(prisma.market.update.mock.calls[0][0].data.ownerId).toBe('owner-2')
		})

		it('rejects a new owner who is not an OWNER or already has a market', async () => {
			prisma.user.findUnique.mockResolvedValue({ id: 'u', role: 'SELLER' })
			await expect(
				service.update('market-1', { ownerId: 'u' }, undefined as any, undefined, true)
			).rejects.toMatchObject({ response: { code: 'MARKET_OWNER_INVALID' } })

			prisma.user.findUnique.mockResolvedValue({ id: 'u', role: 'OWNER' })
			prisma.market.findFirst.mockResolvedValue({ id: 'market-9' })
			await expect(
				service.update('market-1', { ownerId: 'u' }, undefined as any, undefined, true)
			).rejects.toMatchObject({ response: { code: 'MARKET_OWNER_TAKEN' } })
			expect(prisma.market.update).not.toHaveBeenCalled()
		})

		it('writes only the fields that were sent and turns empty contacts into null', async () => {
			await service.update('market-1', { phone: '', workHours: 'Пн–Сб 8:00–18:00' }, undefined as any, 'market-1')

			expect(prisma.market.update.mock.calls[0][0].data).toEqual({
				phone: null,
				workHours: 'Пн–Сб 8:00–18:00'
			})
		})
	})

	describe('updateSettings', () => {
		it('switches allowSellerSales for the owner of the market', async () => {
			await service.updateSettings('market-1', { allowSellerSales: true }, 'market-1')

			expect(prisma.market.update).toHaveBeenCalledWith(
				expect.objectContaining({ where: { id: 'market-1' }, data: { allowSellerSales: true } })
			)
		})

		it('does not touch another market (IDOR)', async () => {
			await expect(service.updateSettings('market-2', { allowSellerSales: true }, 'market-1')).rejects.toThrow(
				NotFoundException
			)
			expect(prisma.market.update).not.toHaveBeenCalled()
		})

		it('lets an ADMIN change settings of any market', async () => {
			await service.updateSettings('market-2', { allowSellerSales: false })

			expect(prisma.market.update).toHaveBeenCalled()
		})
	})

	describe('overview', () => {
		const viewer = (role: string, marketId?: string): any => ({ sub: 'u', id: 'u', role, marketId })

		it('gives an owner counts plus money and stock health', async () => {
			const result: any = await service.overview('market-1', viewer('OWNER', 'market-1'))

			expect(productsService.summary).toHaveBeenCalledWith('market-1')
			expect(debtorsService.getSummary).toHaveBeenCalledWith('market-1')
			expect(result.summary.products).toBe(12)
			expect(result.summary.management).toEqual({
				totalDebt: 900,
				overdueAmount: 300,
				debtorsWithDebt: 4,
				stockRetailValue: 5000,
				stockCostValue: 3500,
				productsWithoutCost: 3,
				outOfStock: 1,
				lowStock: 2
			})
		})

		it('gives a seller counts only: no money, no cost, no emails, no summary queries', async () => {
			const result: any = await service.overview('market-1', viewer('SELLER', 'market-1'))

			expect(result.summary.management).toBeNull()
			expect(productsService.summary).not.toHaveBeenCalled()
			expect(debtorsService.getSummary).not.toHaveBeenCalled()
			expect(result.market.owner.email).toBeUndefined()
		})

		it("keeps a seller and an owner out of other markets (IDOR)", async () => {
			await expect(service.overview('market-2', viewer('SELLER', 'market-1'))).rejects.toThrow(NotFoundException)
			await expect(service.overview('market-2', viewer('OWNER', 'market-1'))).rejects.toThrow(NotFoundException)
		})

		it('treats staff without a market as having no access at all', async () => {
			await expect(service.overview('market-1', viewer('OWNER', undefined))).rejects.toThrow(NotFoundException)
		})

		it('lets an admin read any market and uses the id from the path', async () => {
			await service.overview('market-2', viewer('ADMIN'))

			expect(productsService.summary).toHaveBeenCalledWith('market-2')
			expect(debtorsService.getSummary).toHaveBeenCalledWith('market-2')
		})
	})
})
