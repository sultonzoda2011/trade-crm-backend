import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches, MaxLength, MinLength } from 'class-validator'
import {
	PASSWORD_MIN_LENGTH,
	PASSWORD_PATTERN,
	PASSWORD_PATTERN_MESSAGE
} from '../../common/utils/password.util'

export class ChangePasswordDto {
	@ApiProperty({ description: 'Current password' })
	@IsString()
	@MaxLength(200)
	currentPassword: string

	@ApiProperty({ description: 'New password (min 8 chars, must contain uppercase, lowercase, and digit)' })
	@IsString()
	@MinLength(PASSWORD_MIN_LENGTH)
	@MaxLength(200)
	@Matches(PASSWORD_PATTERN, { message: PASSWORD_PATTERN_MESSAGE })
	newPassword: string

	@ApiProperty({ description: 'Confirm new password (must match newPassword)' })
	@IsString()
	@MaxLength(200)
	confirmPassword: string
}
