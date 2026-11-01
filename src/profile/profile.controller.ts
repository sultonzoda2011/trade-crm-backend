import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Patch,
	UploadedFile
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { Express } from 'express'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { UploadImage } from '../common/decorators/upload-image.decorator'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { ChangePasswordDto } from './dto/change-password.dto'
import { ProfileResponseDto } from './dto/profile-response.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ProfileService } from './profile.service'

@ApiTags('Profile')
@ApiBearerAuth()
@ApiErrorResponse()
@Roles(Role.ADMIN, Role.OWNER, Role.SELLER)
@Controller('profile')
export class ProfileController {
	constructor(private readonly profileService: ProfileService) {}

	@Get()
	@ApiOkResponse({ type: ProfileResponseDto })
	getProfile(@CurrentUser() user: JwtPayload) {
		return this.profileService.getProfile(user.sub)
	}

	@Get('full')
	@ApiOkResponse({ description: 'Profile screen in one round-trip: profile + own market + earnings (sellers only)' })
	getFullProfile(@CurrentUser() user: JwtPayload) {
		return this.profileService.getFullProfile(user)
	}

	@Get('earnings')
	@Roles(Role.SELLER)
	@ApiOkResponse({ description: 'Seller markup balance, current-month totals and the latest payouts' })
	getEarnings(@CurrentUser() user: JwtPayload) {
		return this.profileService.getEarnings(user)
	}

	@Patch()
	@UploadImage()
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				name: { type: 'string', example: 'John Doe' },
				email: { type: 'string', example: 'john@tradecrm.com' },
				phone: { type: 'string', example: '+992 900 12-34-56', description: 'Empty string clears it.' },
				currentPassword: { type: 'string', description: 'Required only when the email changes.' },
				image: { type: 'string', format: 'binary', description: 'New avatar (replaces existing). Omit to keep current.' }
			}
		}
	})
	@ApiOkResponse({ type: ProfileResponseDto })
	updateProfile(
		@Body() dto: UpdateProfileDto,
		@CurrentUser() user: JwtPayload,
		@UploadedFile() file?: Express.Multer.File
	) {
		return this.profileService.updateProfile(user.sub, dto, file)
	}

	@Delete('image')
	@ApiOkResponse({ type: ProfileResponseDto, description: 'Removes the avatar' })
	removeImage(@CurrentUser() user: JwtPayload) {
		return this.profileService.removeImage(user.sub)
	}

	@Patch('password')
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ description: 'Password updated; returns `{ passwordChangedAt }`' })
	changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: JwtPayload) {
		return this.profileService.changePassword(user.sub, dto)
	}
}
