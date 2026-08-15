import {
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	Post,
	Req,
	Res,
	UnauthorizedException
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { Public } from './decorators/public.decorator'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { AuthResponseDto, AuthUserDto } from './dto/auth-response.dto'
import { LoginDto } from './dto/login.dto'

/** Имя cookie для refresh-токена */
const REFRESH_COOKIE = 'refreshToken'
/** Имя cookie для access-токена (httpOnly) */
const ACCESS_COOKIE = 'accessToken'
/** Имя cookie для user info (не httpOnly — читается JS для RBAC) */
const USER_COOKIE = 'user'
/** 30 дней в миллисекундах */
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000
/** 15 минут в миллисекундах — access token TTL */
const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000
/** 30 дней — user cookie TTL */
const USER_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000

@ApiTags('Auth')
@ApiErrorResponse()
@Controller('auth')
export class AuthController {
	private readonly isProduction = process.env.NODE_ENV === 'production'

	constructor(private readonly authService: AuthService) {}

	/**
	 * Устанавливает refresh-токен как httpOnly cookie.
	 * В production: SameSite=None (cross-site, разные Vercel-поддомены) + Secure.
	 * В dev: SameSite=Lax (same-site, localhost).
	 */
	private setRefreshCookie(res: Response, token: string): void {
		res.cookie(REFRESH_COOKIE, token, {
			httpOnly: true,
			secure: this.isProduction,
			sameSite: this.isProduction ? 'none' : 'lax',
			maxAge: REFRESH_COOKIE_MAX_AGE,
			path: '/'
		})
	}

	private clearRefreshCookie(res: Response): void {
		res.clearCookie(REFRESH_COOKIE, {
			httpOnly: true,
			secure: this.isProduction,
			sameSite: this.isProduction ? 'none' : 'lax',
			path: '/'
		})
	}

	/**
	 * Устанавливает access-токен как httpOnly cookie.
	 * В production: SameSite=None (cross-site, разные Vercel-поддомены) + Secure.
	 * В dev: SameSite=Lax (same-site, localhost).
	 */
	private setAccessCookie(res: Response, token: string): void {
		res.cookie(ACCESS_COOKIE, token, {
			httpOnly: true,
			secure: this.isProduction,
			sameSite: this.isProduction ? 'none' : 'lax',
			maxAge: ACCESS_COOKIE_MAX_AGE,
			path: '/'
		})
	}

	private clearAccessCookie(res: Response): void {
		res.clearCookie(ACCESS_COOKIE, {
			httpOnly: true,
			secure: this.isProduction,
			sameSite: this.isProduction ? 'none' : 'lax',
			path: '/'
		})
	}

	/**
	 * Устанавливает user info как не-httpOnly cookie для RBAC на клиенте.
	 * Не httpOnly — доступен JavaScript для проверки прав доступа без API-вызова.
	 */
	private setUserCookie(res: Response, user: AuthUserDto): void {
		res.cookie(USER_COOKIE, encodeURIComponent(JSON.stringify(user)), {
			httpOnly: false,
			secure: this.isProduction,
			sameSite: this.isProduction ? 'none' : 'lax',
			maxAge: USER_COOKIE_MAX_AGE,
			path: '/'
		})
	}

	private clearUserCookie(res: Response): void {
		res.clearCookie(USER_COOKIE, {
			httpOnly: false,
			secure: this.isProduction,
			sameSite: this.isProduction ? 'none' : 'lax',
			path: '/'
		})
	}

	@Public()
	@Throttle({ default: { limit: 5, ttl: 60_000 } })
	@Post('login')
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ description: 'Sets accessToken + refreshToken as httpOnly cookies; returns user + accessToken' })
	@ApiResponse({ status: 401, description: 'Invalid email or password' })
	async login(
		@Body() dto: LoginDto,
		@Res({ passthrough: true }) res: Response
	): Promise<AuthResponseDto> {
		const result = await this.authService.login(dto.email, dto.password)
		this.setRefreshCookie(res, result.refreshToken)
		this.setAccessCookie(res, result.accessToken)
		this.setUserCookie(res, result.user)
		return result
	}

	@Public()
	@Throttle({ default: { limit: 10, ttl: 60_000 } })
	@Post('refresh')
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ description: 'Sets new accessToken + refreshToken as httpOnly cookies; returns user + accessToken' })
	@ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
	async refresh(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	): Promise<{ accessToken: string; user: AuthUserDto }> {
		const token = req.cookies?.[REFRESH_COOKIE] as string | undefined
		if (!token) throw new UnauthorizedException('Refresh token missing')
		const result = await this.authService.refresh(token)
		this.setRefreshCookie(res, result.refreshToken)
		this.setAccessCookie(res, result.accessToken)
		this.setUserCookie(res, result.user)
		return { accessToken: result.accessToken, user: result.user }
	}

	@Post('logout')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiBearerAuth()
	@ApiOkResponse({ description: 'Session terminated; refresh and access cookies cleared' })
	async logout(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	): Promise<void> {
		const token = req.cookies?.[REFRESH_COOKIE] as string | undefined
		if (token) await this.authService.logout(token)
		this.clearRefreshCookie(res)
		this.clearAccessCookie(res)
		this.clearUserCookie(res)
	}
}
