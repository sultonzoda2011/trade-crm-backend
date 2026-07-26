import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { Public } from './decorators/public.decorator'
import { CurrentUser } from './decorators/current-user.decorator'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { multerOptions } from '../common/utils/multipart.util'
import { JwtPayload } from '../interfaces'
import { AuthResponseDto } from './dto/auth-response.dto'
import { LoginDto } from './dto/login.dto'
import { LogoutDto } from './dto/logout.dto'
import { RefreshDto } from './dto/refresh.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ProfileResponseDto } from './dto/profile-response.dto'
import { Express } from 'express'

@ApiTags('Auth')
@ApiErrorResponse()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto.email, dto.password)
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  refresh(@Body() dto: RefreshDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto.refreshToken)
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Token revoked' })
  logout(@Body() dto: LogoutDto): Promise<void> {
    return this.authService.logout(dto.refreshToken)
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOkResponse({ type: ProfileResponseDto })
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user.sub)
  }

  @Patch('profile')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'John Doe' },
        email: { type: 'string', example: 'john@tradecrm.com' },
        oldPassword: { type: 'string', description: 'Current password (required to set a new password)' },
        newPassword: { type: 'string', description: 'New password (min 8 chars, upper+lower+digit)' },
        confirmPassword: { type: 'string', description: 'Confirm new password' },
        image: { type: 'string', format: 'binary', description: 'New avatar (replaces existing). Omit to keep current.' },
      },
    },
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @UseInterceptors(FileInterceptor('image', multerOptions))
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.authService.updateProfile(user!.sub, dto, file)
  }
}
