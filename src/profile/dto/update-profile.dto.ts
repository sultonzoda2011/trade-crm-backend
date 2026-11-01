import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator'
import { NormalizeEmail } from '../../common/utils/email.util'

/** `+992 900 12-34-56`, `(900) 123456`: цифры, пробелы, дефисы, скобки, ведущий «+». */
const PHONE_PATTERN = /^\+?[0-9\s\-()]{7,20}$/

export class UpdateProfileDto {
	@ApiPropertyOptional({ example: 'John Doe' })
	@IsOptional()
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@MinLength(2)
	@MaxLength(100)
	name?: string

	@ApiPropertyOptional({ example: 'john@tradecrm.com', description: 'Changing the email requires currentPassword.' })
	@IsOptional()
	@NormalizeEmail()
	@IsEmail()
	@MaxLength(200)
	email?: string

	@ApiPropertyOptional({ example: '+992 900 12-34-56', description: 'Empty string clears the phone.' })
	@IsOptional()
	@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
	@ValidateIf((_, value) => value !== '')
	@IsString()
	@Matches(PHONE_PATTERN, { message: 'Phone must contain 7–20 digits, spaces, dashes or brackets' })
	phone?: string

	/** Нужен только при смене email: опечатка в логине без «забыл пароль» блокирует аккаунт. */
	@ApiPropertyOptional({ description: 'Required when the email changes.' })
	@IsOptional()
	@IsString()
	@MaxLength(200)
	currentPassword?: string
}
