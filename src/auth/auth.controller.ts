import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { AuthService } from './auth.service'
import { Public } from './decorators/public.decorator'
import { AuthResponseDto } from './dto/auth-response.dto'
import { LoginDto } from './dto/login.dto'

@ApiTags('Auth')
@ApiErrorResponse()
@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	/**
	 * Возвращает accessToken и данные пользователя в теле ответа.
	 * Клиент сохраняет accessToken сам (localStorage / secure storage) и
	 * отправляет его дальше как `Authorization: Bearer <token>`.
	 * Cookie больше не используются.
	 */
	@Public()
	@Throttle({ default: { limit: 5, ttl: 60_000 } })
	@Post('login')
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({
		description: 'Returns accessToken + user; send accessToken back as Authorization: Bearer <token>'
	})
	@ApiResponse({ status: 401, description: 'Invalid email or password' })
	async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
		return this.authService.login(dto.email, dto.password)
	}
}
