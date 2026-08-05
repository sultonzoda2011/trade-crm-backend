import { Test } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { compare } from 'bcrypt'
import { AuthService } from './auth.service'
import { Role } from '../enums'
import { PrismaService } from '../prisma/prisma.service'

jest.mock('bcrypt')

describe('AuthService', () => {
	let service: AuthService
	let prisma: any
	let jwtService: any

	const userRow = {
		id: 'user-1',
		email: 'owner@x.com',
		password: 'hashed-pass',
		name: 'Owner',
		role: Role.OWNER,
		marketId: 'market-1'
	}

	beforeEach(async () => {
		prisma = {
			user: { findUnique: jest.fn() },
			refreshToken: {
				findUnique: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn()
			}
		}
		jwtService = {
			signAsync: jest.fn().mockResolvedValue('access-token')
		}

		const moduleRef = await Test.createTestingModule({
			providers: [
				AuthService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: JwtService, useValue: jwtService },
				{
					provide: ConfigService,
					useValue: {
						getOrThrow: jest.fn().mockReturnValue('30d')
					}
				}
			]
		}).compile()

		service = moduleRef.get(AuthService)
	})

	describe('login', () => {
		it('throws UnauthorizedException when user not found', async () => {
			prisma.user.findUnique.mockResolvedValue(null)
			await expect(service.login('nobody@x.com', 'pass')).rejects.toThrow(
				UnauthorizedException
			)
		})

		it('throws UnauthorizedException when password is wrong', async () => {
			prisma.user.findUnique.mockResolvedValue(userRow)
			;(compare as jest.Mock).mockResolvedValue(false)
			await expect(service.login('owner@x.com', 'wrong')).rejects.toThrow(
				UnauthorizedException
			)
		})

		it('returns tokens + user on success', async () => {
			prisma.user.findUnique.mockResolvedValue(userRow)
			;(compare as jest.Mock).mockResolvedValue(true)
			prisma.refreshToken.create.mockResolvedValue({})

			const result = await service.login('owner@x.com', '12345678Aa')

			expect(result.accessToken).toBe('access-token')
			expect(result.refreshToken).toBeDefined()
			expect(jwtService.signAsync).toHaveBeenCalledWith(
				expect.objectContaining({
					sub: 'user-1',
					email: 'owner@x.com',
					role: Role.OWNER,
					marketId: 'market-1'
				})
			)
			expect(result.user.marketId).toBe('market-1')
		})

		it('stores a SHA-256 hash of the refresh token, not the raw token', async () => {
			prisma.user.findUnique.mockResolvedValue(userRow)
			;(compare as jest.Mock).mockResolvedValue(true)
			prisma.refreshToken.create.mockResolvedValue({})

			const result = await service.login('owner@x.com', '12345678Aa')

			expect(prisma.refreshToken.create).toHaveBeenCalled()
			const data = prisma.refreshToken.create.mock.calls[0][0].data
			expect(data.token).toMatch(/^[a-f0-9]{64}$/)
			expect(data.token).not.toBe(result.refreshToken)
		})
	})

	describe('refresh', () => {
		const storedToken = {
			id: 'rt-1',
			token: 'hash',
			userId: 'user-1',
			revokedAt: null,
			expiresAt: new Date(Date.now() + 1000 * 60),
			user: userRow
		}

		it('throws when token not found', async () => {
			prisma.refreshToken.findUnique.mockResolvedValue(null)
			await expect(service.refresh('unknown')).rejects.toThrow(
				UnauthorizedException
			)
		})

		it('throws and revokes all user tokens when token was already revoked (reuse detection)', async () => {
			prisma.refreshToken.findUnique.mockResolvedValue({
				...storedToken,
				revokedAt: new Date()
			})

			await expect(service.refresh('stale-token')).rejects.toThrow(
				'Refresh token has been revoked'
			)
			expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
				where: { userId: 'user-1', revokedAt: null },
				data: { revokedAt: expect.any(Date) }
			})
		})

		it('throws when token expired', async () => {
			prisma.refreshToken.findUnique.mockResolvedValue({
				...storedToken,
				expiresAt: new Date(Date.now() - 1000)
			})
			await expect(service.refresh('expired')).rejects.toThrow(
				'Refresh token has expired'
			)
		})

		it('rotates: atomically revokes old token and issues new pair', async () => {
			prisma.refreshToken.findUnique.mockResolvedValue(storedToken)
			prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 })
			prisma.refreshToken.create.mockResolvedValue({})

			const result = await service.refresh('valid-token')

			expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
				where: { id: 'rt-1', revokedAt: null },
				data: { revokedAt: expect.any(Date) }
			})
			expect(result.accessToken).toBe('access-token')
			expect(result.refreshToken).toBeDefined()
			expect(prisma.refreshToken.create).toHaveBeenCalled()
		})

		it('handles the rotation race: count === 0 revokes all tokens and rejects', async () => {
			prisma.refreshToken.findUnique.mockResolvedValue(storedToken)
			// Конкурирующий запрос уже отозвал этот токен — наш updateMany
			// не затронул ни одной строки.
			prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })

			await expect(service.refresh('contended-token')).rejects.toThrow(
				'Refresh token has been revoked'
			)
			expect(prisma.refreshToken.updateMany).toHaveBeenLastCalledWith({
				where: { userId: 'user-1', revokedAt: null },
				data: { revokedAt: expect.any(Date) }
			})
		})
	})

	describe('logout', () => {
		it('does nothing when token is missing or already revoked', async () => {
			prisma.refreshToken.findUnique.mockResolvedValue(null)
			await expect(service.logout('x')).resolves.toBeUndefined()
			expect(prisma.refreshToken.update).not.toHaveBeenCalled()
		})

		it('revokes the token when found', async () => {
			prisma.refreshToken.findUnique.mockResolvedValue({
				id: 'rt-1',
				revokedAt: null
			})
			await service.logout('valid')
			expect(prisma.refreshToken.update).toHaveBeenCalledWith({
				where: { id: 'rt-1' },
				data: { revokedAt: expect.any(Date) }
			})
		})
	})
})