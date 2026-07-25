import { IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class CreateCategoryDto {
  @ApiProperty({ example: 'Beverages' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string
}
