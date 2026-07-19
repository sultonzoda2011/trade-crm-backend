import { IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class CreateProductDto {
  @ApiProperty({ example: 'Apple' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string

  @ApiProperty({ example: 1.5 })
  @IsNumber()
  @Min(0.01)
  price: number

  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(0)
  quantity: number
}
