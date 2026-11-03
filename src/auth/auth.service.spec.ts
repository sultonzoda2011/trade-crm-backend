import { UnauthorizedException } from '@nestjs/common'
import { hash } from 'bcrypt'
import { AuthService } from './auth.service'

describe('AuthService.login', () => {
	let service: AuthService
	let prisma: any
	let jwt: any
	let passwordHash: string

	beforeAll(async () => {
		passwordHash = await hash('Secret123', 4)
	})

	beforeEach(() => {
		prisma = { user: { findFirst: jest.fn() } }
		jwt = { signAsync: jest.fn().mockResolvedValue('token') }
		service = new AuthService(prisma, jwt)
	})

	it('finds the user by email without regard to case', async () => {
		prisma.user.findFirst.mockResolvedValue({
			id: 'u1',
			name: 'Ali',
			email: 'Ali@X.com',
			role: 'OWNER',
			password: passwordHash,
			image: null,
			marketId: null
		})

		const res = await service.login('ali@x.com', 'Secret123')

		expect(prisma.user.findFirst.mock.calls[0][0].where.email).toEqual({ equals: 'ali@x.com', mode: 'insensitive' })
		expect(res.accessToken).toBe('token')
	})

	it('rejects an unknown email and a wrong password with the same error', async () => {
		prisma.user.findFirst.mockResolvedValueOnce(null)
		await expect(service.login('ghost@x.com', 'Secret123')).rejects.toThrow(UnauthorizedException)

		prisma.user.findFirst.mockResolvedValueOnce({ id: 'u1', email: 'a@x.com', role: 'OWNER', password: passwordHash })
		await expect(service.login('a@x.com', 'Wrong1234')).rejects.toThrow(UnauthorizedException)
	})

	it('a disabled account cannot log in — but only someone with the right password learns that', async () => {
		const disabled = { id: 'u1', email: 'a@x.com', role: 'SELLER', password: passwordHash, isActive: false }

		prisma.user.findFirst.mockResolvedValueOnce(disabled)
		await expect(service.login('a@x.com', 'Secret123')).rejects.toMatchObject({
			response: { code: 'ACCOUNT_DISABLED' }
		})
		expect(jwt.signAsync).not.toHaveBeenCalled()

		prisma.user.findFirst.mockResolvedValueOnce(disabled)
		await expect(service.login('a@x.com', 'Wrong1234')).rejects.toThrow(UnauthorizedException)
	})
})
