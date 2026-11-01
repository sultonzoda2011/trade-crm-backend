import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { compare, hash } from 'bcrypt'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { ProfileService } from './profile.service'

const seller: JwtPayload = {
	sub: 'seller-1',
	id: 'seller-1',
	email: 's@x.com',
	name: 'Seller',
	role: Role.SELLER,
	marketId: 'market-1'
}
const owner: JwtPayload = { ...seller, sub: 'owner-1', id: 'owner-1', role: Role.OWNER }

describe('ProfileService', () => {
	let service: ProfileService
	let prisma: any
	let storage: any
	let markets: any
	let sellers: any
	let config: any
	let passwordHash: string

	const dbUser = (over: Record<string, unknown> = {}) => ({
		id: 'u1',
		name: 'Ali',
		email: 'ali@x.com',
		password: passwordHash,
		image: null,
		...over
	})

	beforeAll(async () => {
		passwordHash = await hash('OldPass1', 4)
	})

	beforeEach(() => {
		prisma = {
			user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
			transaction: { count: jest.fn().mockResolvedValue(0) },
			transactionItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { markup: 0 } }) }
		}
		storage = { save: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) }
		markets = { findOne: jest.fn().mockResolvedValue({ id: 'market-1' }) }
		sellers = {
			getBalance: jest.fn().mockResolvedValue({ sellerId: 'seller-1', earned: 500, refunded: 50, paidOut: 100, balance: 350 }),
			listCredits: jest.fn().mockResolvedValue({ data: [{ id: 'c1', amount: 100 }], meta: {} })
		}
		config = { get: jest.fn().mockReturnValue(4) }
		service = new ProfileService(prisma, storage, markets, sellers, config)
		prisma.user.update.mockImplementation(async ({ data }: any) => ({ id: 'u1', ...data }))
	})

	describe('getFullProfile', () => {
		beforeEach(() => prisma.user.findUnique.mockResolvedValue({ id: 'x' }))

		it('adds earnings only for sellers', async () => {
			const asSeller = await service.getFullProfile(seller)
			expect(asSeller.earnings).not.toBeNull()
			expect(sellers.getBalance).toHaveBeenCalledWith('seller-1', 'market-1')

			const asOwner = await service.getFullProfile(owner)
			expect(asOwner.earnings).toBeNull()
			expect(sellers.getBalance).toHaveBeenCalledTimes(1)
		})

		it('scopes the market of an owner to their own market id', async () => {
			await service.getFullProfile(owner)
			expect(markets.findOne).toHaveBeenCalledWith('market-1', 'market-1')
		})

		it('has no market and no earnings for an admin without a market', async () => {
			const admin = { ...owner, role: Role.ADMIN, marketId: undefined }
			const res = await service.getFullProfile(admin)
			expect(res.market).toBeNull()
			expect(res.earnings).toBeNull()
		})
	})

	describe('getEarnings', () => {
		it('returns balance, credits preview and net month markup', async () => {
			prisma.transaction.count.mockResolvedValue(7)
			prisma.transactionItem.aggregate
				.mockResolvedValueOnce({ _sum: { markup: 120.5 } })
				.mockResolvedValueOnce({ _sum: { markup: 20.25 } })

			const res = await service.getEarnings(seller)

			expect(res.balance).toEqual({ earned: 500, refunded: 50, paidOut: 100, balance: 350 })
			expect(res.month.salesCount).toBe(7)
			expect(res.month.earned).toBe(100.25)
			expect(res.credits).toHaveLength(1)
			expect(sellers.listCredits).toHaveBeenCalledWith('seller-1', { page: 1, limit: 5 }, 'market-1')
		})

		it('is not available to non-sellers', async () => {
			await expect(service.getEarnings(owner)).rejects.toThrow(NotFoundException)
		})
	})

	describe('updateProfile', () => {
		it('changes name and phone without a password', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser())
			await service.updateProfile('u1', { name: 'Ali K', phone: '+992 900 11-22-33' })
			expect(prisma.user.update.mock.calls[0][0].data).toEqual({ name: 'Ali K', phone: '+992 900 11-22-33' })
		})

		it('clears the phone with an empty string', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser())
			await service.updateProfile('u1', { phone: '' })
			expect(prisma.user.update.mock.calls[0][0].data.phone).toBeNull()
		})

		it('does not ask for a password when only the email case differs', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser({ email: 'Ali@X.com' }))
			await service.updateProfile('u1', { email: 'ali@x.com' })
			expect(prisma.user.update.mock.calls[0][0].data.email).toBeUndefined()
		})

		it('requires the current password to change the email', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser())
			await expect(service.updateProfile('u1', { email: 'new@x.com' })).rejects.toMatchObject({
				response: { code: 'CURRENT_PASSWORD_REQUIRED' }
			})
			expect(prisma.user.update).not.toHaveBeenCalled()
		})

		it('rejects a wrong current password', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser())
			await expect(
				service.updateProfile('u1', { email: 'new@x.com', currentPassword: 'Nope1234' })
			).rejects.toMatchObject({ response: { code: 'CURRENT_PASSWORD_INCORRECT' } })
		})

		it('rejects an email that someone else already uses (case-insensitive)', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser())
			prisma.user.findFirst.mockResolvedValue({ id: 'other' })
			await expect(
				service.updateProfile('u1', { email: 'taken@x.com', currentPassword: 'OldPass1' })
			).rejects.toThrow(ConflictException)
			expect(prisma.user.findFirst.mock.calls[0][0].where.email).toEqual({ equals: 'taken@x.com', mode: 'insensitive' })
		})

		it('changes the email with the right password', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser())
			prisma.user.findFirst.mockResolvedValue(null)
			await service.updateProfile('u1', { email: 'new@x.com', currentPassword: 'OldPass1' })
			expect(prisma.user.update.mock.calls[0][0].data.email).toBe('new@x.com')
		})

		it('uploads the new avatar as a square, then removes the old one', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser({ image: 'https://cdn/old.jpg' }))
			storage.save.mockResolvedValue('https://cdn/new.jpg')
			await service.updateProfile('u1', {}, { buffer: Buffer.from('x') } as any)
			expect(storage.save).toHaveBeenCalledWith(expect.anything(), 'users', { square: 512 })
			expect(prisma.user.update.mock.calls[0][0].data.image).toBe('https://cdn/new.jpg')
			expect(storage.delete).toHaveBeenCalledWith('https://cdn/old.jpg')
		})

		it('keeps the old avatar and drops the upload if the database write fails', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser({ image: 'https://cdn/old.jpg' }))
			storage.save.mockResolvedValue('https://cdn/new.jpg')
			prisma.user.update.mockRejectedValue(new Error('db down'))
			await expect(service.updateProfile('u1', {}, { buffer: Buffer.from('x') } as any)).rejects.toThrow('db down')
			expect(storage.delete).toHaveBeenCalledTimes(1)
			expect(storage.delete).toHaveBeenCalledWith('https://cdn/new.jpg')
		})
	})

	describe('removeImage', () => {
		it('clears the avatar and deletes the file', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser({ image: 'https://cdn/old.jpg' }))
			await service.removeImage('u1')
			expect(prisma.user.update.mock.calls[0][0].data).toEqual({ image: null })
			expect(storage.delete).toHaveBeenCalledWith('https://cdn/old.jpg')
		})

		it('is a no-op without an avatar', async () => {
			prisma.user.findUnique.mockResolvedValue(dbUser())
			await service.removeImage('u1')
			expect(prisma.user.update).not.toHaveBeenCalled()
			expect(storage.delete).not.toHaveBeenCalled()
		})
	})

	describe('changePassword', () => {
		const dto = { currentPassword: 'OldPass1', newPassword: 'NewPass1', confirmPassword: 'NewPass1' }

		beforeEach(() => prisma.user.findUnique.mockResolvedValue(dbUser()))

		it('rejects when the confirmation does not match (before touching bcrypt)', async () => {
			await expect(service.changePassword('u1', { ...dto, confirmPassword: 'Other123' })).rejects.toMatchObject({
				response: { code: 'PASSWORD_MISMATCH' }
			})
			expect(prisma.user.update).not.toHaveBeenCalled()
		})

		it('rejects a wrong current password with 400, not 401', async () => {
			const err = await service.changePassword('u1', { ...dto, currentPassword: 'Wrong123' }).catch(e => e)
			expect(err).toBeInstanceOf(BadRequestException)
			expect(err.response.code).toBe('CURRENT_PASSWORD_INCORRECT')
		})

		it('rejects reusing the current password', async () => {
			await expect(
				service.changePassword('u1', { currentPassword: 'OldPass1', newPassword: 'OldPass1', confirmPassword: 'OldPass1' })
			).rejects.toMatchObject({ response: { code: 'PASSWORD_SAME_AS_CURRENT' } })
		})

		it('hashes with the configured rounds and stamps passwordChangedAt', async () => {
			const res = await service.changePassword('u1', dto)
			const data = prisma.user.update.mock.calls[0][0].data
			expect(await compare('NewPass1', data.password)).toBe(true)
			expect(data.passwordChangedAt).toBeInstanceOf(Date)
			expect(res.passwordChangedAt).toBe(data.passwordChangedAt)
			expect(config.get).toHaveBeenCalledWith('BCRYPT_ROUNDS')
		})
	})
})
