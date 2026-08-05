import { Test } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtStrategy } from './jwt.strategy'
import { Role } from '../../enums'
import { PrismaService } from '../../prisma/prisma.service'

// pasport-jwt Strategy берёт секрет в конструкторе super(); передаём заглушку.
describe('JwtStrategy', () => {
	let strategy: JwtStrategy
	let prisma: { user: { findUnique: jest.Mock } }

	const userRow = {
		id: 'user-1',
		email: 'owner@x.com',
		name: 'Owner',
		role: Role.OWNER,
		marketId: 'market-1'
	}

	const payload = {
		sub: 'user-1',
		email: 'owner@x.com',
		role: Role.OWNER,
		name: 'Owner',
		marketId: 'market-1',
		id: 'user-1'
	}

	beforeEach(async () => {
		prisma = { user: { findUnique: jest.fn() } }

		const moduleRef = await Test.createTestingModule({
			providers: [
				JwtStrategy,
				{ provide: ConfigService, useValue: { getOrThrow: jest.fn().mockReturnValue('secret') } },
				{ provide: PrismaService, useValue: prisma }
			]
		}).compile()

		strategy = moduleRef.get(JwtStrategy)
		strategy['cache'].clear()
	})

	describe('validate', () => {
		it('rejects when user no longer exists and clears cache', async () => {
			prisma.user.findUnique.mockResolvedValue(null)
			await expect(strategy.validate(payload)).rejects.toThrow(
				UnauthorizedException
			)
			expect(strategy['cache'].has('user-1')).toBe(false)
		})

		it('builds a payload from the fetched user', async () => {
			prisma.user.findUnique.mockResolvedValue(userRow)
			const result = await strategy.validate(payload)
			expect(result).toEqual({
				sub: 'user-1',
				email: 'owner@x.com',
				role: Role.OWNER,
				name: 'Owner',
				marketId: 'market-1',
				id: 'user-1'
			})
		})

		it('serves subsequent requests from cache without hitting the DB', async () => {
			prisma.user.findUnique.mockResolvedValue(userRow)

			await strategy.validate(payload)
			await strategy.validate(payload)
			await strategy.validate(payload)

			expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
		})
	})
})