import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { compare } from 'bcrypt'
import { createHash, randomUUID } from 'crypto'
import { JwtPayload } from '../interfaces'
import { PrismaService } from '../prisma/prisma.service'
import { AuthResponseDto } from './dto/auth-response.dto'

@Injectable()
export class AuthService {
	private readonly refreshTokenExpiresIn: string
	private readonly logger = new Logger(AuthService.name)

	constructor(
		private readonly prisma: PrismaService,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService
	) {
		this.refreshTokenExpiresIn = this.configService.getOrThrow<string>(
			'JWT_REFRESH_EXPIRES_IN'
		)
	}

	async login(email: string, password: string): Promise<AuthResponseDto> {
		const user = await this.prisma.user.findUnique({ where: { email } })

		if (!user) {
			throw new UnauthorizedException('Invalid email or password')
		}

		const isPasswordValid = await compare(password, user.password)
		if (!isPasswordValid) {
			throw new UnauthorizedException('Invalid email or password')
		}

		return this.generateTokens(user.id, user.email, user.role as any, {
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			image: user.image ?? undefined,
			marketId: user.marketId ?? undefined
		})
	}

	async refresh(refreshToken: string): Promise<AuthResponseDto> {
		const tokenHash = this.hashToken(refreshToken)

		const storedToken = await this.prisma.refreshToken.findUnique({
			where: { token: tokenHash },
			include: { user: true }
		})

		if (!storedToken) {
			throw new UnauthorizedException('Invalid refresh token')
		}

		if (storedToken.revokedAt) {
			// Токен уже был использован/отозван, но его снова пытаются применить —
			// возможный признак кражи токена. Отзываем все refresh-токены пользователя.
			await this.revokeAllUserTokens(storedToken.userId)
			this.logger.warn(
				`Refresh token reuse detected for user ${storedToken.userId}`
			)
			throw new UnauthorizedException('Refresh token has been revoked')
		}

		if (new Date() > storedToken.expiresAt) {
			throw new UnauthorizedException('Refresh token has expired')
		}

		// Атомарное отозвание через updateMany с условием revokedAt: null. Если
		// токен одновременно используют два запроса (гонка), ровно один из них
		// обновит строку (count === 1), второй увидит count === 0 — повторное
		// использование токена, отзываем всё у пользователя.
		const rotated = await this.prisma.refreshToken.updateMany({
			where: { id: storedToken.id, revokedAt: null },
			data: { revokedAt: new Date() }
		})

		if (rotated.count === 0) {
			await this.revokeAllUserTokens(storedToken.userId)
			this.logger.warn(
				`Concurrent refresh-token rotation for user ${storedToken.userId}`
			)
			throw new UnauthorizedException('Refresh token has been revoked')
		}

		return this.generateTokens(
			storedToken.user.id,
			storedToken.user.email,
			storedToken.user.role as any,
			{
				id: storedToken.user.id,
				name: storedToken.user.name,
				email: storedToken.user.email,
				role: storedToken.user.role,
				marketId: storedToken.user.marketId ?? undefined
			}
		)
	}

	async logout(refreshToken: string): Promise<void> {
		const tokenHash = this.hashToken(refreshToken)

		const storedToken = await this.prisma.refreshToken.findUnique({
			where: { token: tokenHash }
		})

		if (!storedToken || storedToken.revokedAt) {
			return
		}

		await this.prisma.refreshToken.update({
			where: { id: storedToken.id },
			data: { revokedAt: new Date() }
		})
	}

	private async revokeAllUserTokens(userId: string): Promise<void> {
		await this.prisma.refreshToken.updateMany({
			where: { userId, revokedAt: null },
			data: { revokedAt: new Date() }
		})
	}

	private async generateTokens(
		userId: string,
		email: string,
		role: string,
		user: {
			id: string
			name: string
			email: string
			role: string
			marketId?: string
			image?: string
		}
	): Promise<AuthResponseDto> {
		const payload: JwtPayload = {
			sub: userId,
			name: user.name,
			email: user.email,
			role: role as any,
			marketId: user.marketId,
			id: user.id
		}

		const [accessToken, refreshTokenValue] = await Promise.all([
			this.jwtService.signAsync(payload),
			this.createRefreshToken(userId)
		])

		return {
			accessToken,
			refreshToken: refreshTokenValue,
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
				marketId: user.marketId
			}
		}
	}

	private async createRefreshToken(userId: string): Promise<string> {
		// Клиенту отдаём случайный токен, а в БД храним только его хеш —
		// утечка базы не даёт напрямую рабочие refresh-токены.
		const token = randomUUID()
		const tokenHash = this.hashToken(token)

		const expiresInMs = this.parseDuration(this.refreshTokenExpiresIn)
		const expiresAt = new Date(Date.now() + expiresInMs)

		await this.prisma.refreshToken.create({
			data: { token: tokenHash, userId, expiresAt }
		})

		return token
	}

	private hashToken(token: string): string {
		return createHash('sha256').update(token).digest('hex')
	}

	private parseDuration(duration: string): number {
		const match = duration.match(/^(\d+)([smhd])$/)
		if (!match) return 7 * 24 * 60 * 60 * 1000

		const value = parseInt(match[1], 10)
		const unit = match[2]

		switch (unit) {
			case 's':
				return value * 1000
			case 'm':
				return value * 60 * 1000
			case 'h':
				return value * 60 * 60 * 1000
			case 'd':
				return value * 24 * 60 * 60 * 1000
			default:
				return 7 * 24 * 60 * 60 * 1000
		}
	}
}
