import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator'
import { Transform } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** `+992 900 12-34-56`, `(900) 123456`: цифры, пробелы, дефисы, скобки, ведущий «+». */
const PHONE_PATTERN = /^\+?[0-9\s\-()]{7,20}$/

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class CreateMarketDto {
  @ApiProperty({ example: 'Central Market', description: 'Market name (2-200 characters)' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string

  @ApiProperty({ example: '123 Main St', description: 'Market address (5-500 characters)' })
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address: string

  @ApiPropertyOptional({ example: '+992 900 12-34-56', description: 'Market phone. Empty string clears it.' })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'Phone must contain 7–20 digits, spaces, dashes or brackets' })
  phone?: string

  @ApiPropertyOptional({ example: 'Пн–Сб 8:00–18:00', description: 'Working hours, free text (up to 200 chars). Empty string clears it.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  workHours?: string

  @ApiPropertyOptional({ description: 'Owner user ID. Must be a user with the OWNER role who owns no other market.' })
  @IsOptional()
  @IsUUID()
  ownerId?: string
}
