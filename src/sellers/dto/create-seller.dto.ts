import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { NormalizeEmail } from '../../common/utils/email.util'
import { PASSWORD_PATTERN, PASSWORD_PATTERN_MESSAGE } from '../../common/utils/password.util'

/** `+992 900 12-34-56`, `(900) 123456`: цифры, пробелы, дефисы, скобки, ведущий «+». */
export const PHONE_PATTERN = /^\+?[0-9\s\-()]{7,20}$/

export class CreateSellerDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string

  @ApiProperty({ example: 'seller@tradecrm.com' })
  @NormalizeEmail()
  @IsEmail()
  email: string

  @ApiProperty({ example: 'StrongP@ss1' })
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_PATTERN_MESSAGE })
  password: string

  @ApiPropertyOptional({ example: '+992 900 12-34-56', description: 'Empty string clears the phone.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'Phone must contain 7–20 digits, spaces, dashes or brackets' })
  phone?: string

  @ApiPropertyOptional({
    description: 'Market of the new seller. Required for ADMIN; ignored for OWNER (always their own market).'
  })
  @IsOptional()
  @IsUUID()
  marketId?: string
}
