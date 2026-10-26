import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { compare } from 'bcrypt'
import { JwtPayload } from '../interfaces'
import { PrismaService } from '../prisma/prisma.service'
import { AuthResponseDto } from './dto/auth-response.dto'

@Injectable()
export class AuthService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly jwtService: JwtService
	) {}

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

		const accessToken = await this.jwtService.signAsync(payload)

		return {
			accessToken,
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
				marketId: user.marketId
			}
		}
	}
}
