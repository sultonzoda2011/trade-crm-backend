import { IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class CreateDebtorDto {
  @ApiProperty({ example: 'Ivan Petrov' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string

  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Matches(/^\+?\d{7,15}$/, {
    message: 'Phone must contain 7-15 digits, optionally starting with +',
  })
  phone: string
}
