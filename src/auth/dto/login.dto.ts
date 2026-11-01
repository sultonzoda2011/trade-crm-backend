import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { NormalizeEmail } from '../../common/utils/email.util'

export class LoginDto {
  @ApiProperty({ example: 'admin@tradecrm.com' })
  @NormalizeEmail()
  @IsEmail()
  email: string

  @ApiProperty({ example: 'StrongP@ss1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string
}
