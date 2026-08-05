import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { Role } from '../../enums'
import { JwtPayload } from '../../interfaces'
import { PrismaService } from '../../prisma/prisma.service'

const CACHE_TTL_MS = 60_000

interface CachedUser {
	payload: JwtPayload
	expiresAt: number
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
	private readonly cache = new Map<string, CachedUser>()

	constructor(
		configService: ConfigService,
		private readonly prisma: PrismaService
	) {
		super({
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			ignoreExpiration: false,
			secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET')
		})
	}

	async validate(payload: JwtPayload): Promise<JwtPayload> {
		const cached = this.cache.get(payload.sub)
		const now = Date.now()
		if (cached && cached.expiresAt > now) {
			return cached.payload
		}

		const user = await this.prisma.user.findUnique({
			where: { id: payload.sub },
			select: {
				id: true,
				email: true,
				role: true,
				name: true,
				marketId: true,
				image: true
			}
		})

		if (!user) {
			this.cache.delete(payload.sub)
			throw new UnauthorizedException('User no longer exists')
		}

		const result: JwtPayload = {
			sub: user.id,
			email: user.email,
			role: user.role as Role,
			name: user.name,
			marketId: user.marketId ?? undefined,
			image: user.image ?? undefined,
			id: user.id
		}

		this.cache.set(payload.sub, {
			payload: result,
			expiresAt: now + CACHE_TTL_MS
		})

		return result
	}
}
