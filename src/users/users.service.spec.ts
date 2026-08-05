import { ConflictException } from '@nestjs/common'
import { UsersService } from './users.service'
import { Role } from '../enums'

describe('UsersService (last admin protection)', () => {
	let service: UsersService
	let prisma: any
	let storageService: any

	const adminRow = {
		id: 'admin-1',
		name: 'Admin',
		email: 'admin@x.com',
		image: null,
		role: Role.ADMIN,
		createdAt: new Date(),
		market: null
	}

	beforeEach(() => {
		prisma = {
			user: {
				findUnique: jest.fn(),
				count: jest.fn(),
				update: jest.fn(),
				delete: jest.fn()
			}
		}
		storageService = {
			save: jest.fn(),
			delete: jest.fn()
		}
		service = new UsersService(prisma, storageService)
	})

	describe('remove', () => {
		it('rejects deleting the last admin', async () => {
			prisma.user.findUnique.mockResolvedValue(adminRow)
			prisma.user.count.mockResolvedValue(1)

			await expect(service.remove('admin-1')).rejects.toThrow(ConflictException)
			expect(prisma.user.delete).not.toHaveBeenCalled()
		})

		it('allows deleting an admin when another admin exists', async () => {
			prisma.user.findUnique.mockResolvedValue(adminRow)
			prisma.user.count.mockResolvedValue(2)

			await service.remove('admin-1')

			expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'admin-1' } })
		})

		it('skips the admin check for non-admins', async () => {
			prisma.user.findUnique.mockResolvedValue({
				...adminRow,
				role: Role.SELLER
			})

			await service.remove('seller-1')

			expect(prisma.user.count).not.toHaveBeenCalled()
			expect(prisma.user.delete).toHaveBeenCalled()
		})
	})

	describe('update', () => {
		it('rejects demoting the last admin', async () => {
			prisma.user.findUnique.mockResolvedValue(adminRow)
			prisma.user.count.mockResolvedValue(1)

			await expect(
				service.update('admin-1', { role: Role.OWNER })
			).rejects.toThrow(ConflictException)
			expect(prisma.user.update).not.toHaveBeenCalled()
		})

		it('allows demoting an admin when another admin exists', async () => {
			prisma.user.findUnique.mockResolvedValue(adminRow)
			prisma.user.count.mockResolvedValue(2)

			await service.update('admin-1', { role: Role.OWNER })

			expect(prisma.user.update).toHaveBeenCalled()
		})

		it('allows updating non-role fields of an admin without checks', async () => {
			prisma.user.findUnique.mockResolvedValue(adminRow)

			await service.update('admin-1', { name: 'New Name' })

			expect(prisma.user.count).not.toHaveBeenCalled()
			expect(prisma.user.update).toHaveBeenCalled()
		})
	})
})
