import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ example: 'john@tradecrm.com' })
  @IsOptional()
  @IsEmail()
  email?: string

  @ApiPropertyOptional({ description: 'Current password (required to set a new password)' })
  @IsOptional()
  @IsString()
  oldPassword?: string

  @ApiPropertyOptional({ description: 'New password (min 8 chars, must contain uppercase, lowercase, and digit)' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one lowercase, one uppercase, and one digit',
  })
  newPassword?: string

  @ApiPropertyOptional({ description: 'Confirm new password (must match newPassword)' })
  @IsOptional()
  @IsString()
  confirmPassword?: string
}
