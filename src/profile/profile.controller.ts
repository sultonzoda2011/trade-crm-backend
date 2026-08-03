import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Patch,
	UploadedFile,
	UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { Express } from 'express'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { multerOptions } from '../common/utils/multipart.util'
import { JwtPayload } from '../interfaces'
import { ChangePasswordDto } from './dto/change-password.dto'
import { ProfileResponseDto } from './dto/profile-response.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ProfileService } from './profile.service'

@ApiTags('Profile')
@ApiErrorResponse()
@Controller('profile')
export class ProfileController {
	constructor(private readonly profileService: ProfileService) {}

	@Get()
	@ApiBearerAuth()
	@ApiOkResponse({ type: ProfileResponseDto })
	getProfile(@CurrentUser() user: JwtPayload) {
		return this.profileService.getProfile(user.sub)
	}

	@Patch()
	@ApiBearerAuth()
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				name: { type: 'string', example: 'John Doe' },
				email: { type: 'string', example: 'john@tradecrm.com' },
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
		return this.profileService.updateProfile(user!.sub, dto, file)
	}

	@Patch('password')
	@HttpCode(HttpStatus.OK)
	@ApiBearerAuth()
	@ApiOkResponse({ description: 'Password updated' })
	changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: JwtPayload) {
		return this.profileService.changePassword(user.sub, dto)
	}
}