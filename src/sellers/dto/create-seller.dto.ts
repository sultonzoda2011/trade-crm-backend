import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { NormalizeEmail } from '../../common/utils/email.util'

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
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one lowercase, one uppercase, and one digit',
  })
  password: string
}
