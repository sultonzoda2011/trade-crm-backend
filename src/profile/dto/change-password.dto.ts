import { IsString, Matches, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password' })
  @IsString()
  currentPassword: string

  @ApiProperty({ description: 'New password (min 8 chars, must contain uppercase, lowercase, and digit)' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one lowercase, one uppercase, and one digit',
  })
  newPassword: string

  @ApiProperty({ description: 'Confirm new password (must match newPassword)' })
  @IsString()
  confirmPassword: string
}