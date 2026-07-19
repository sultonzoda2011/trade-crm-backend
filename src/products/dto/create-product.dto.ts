import { IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateProductDto {
  @ApiProperty({ example: 'Apple', description: 'Product name (2-200 characters)' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string

  @ApiPropertyOptional({ example: 'Fresh red apples', description: 'Product description (max 1000 characters)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string

  @ApiProperty({ example: 1.5, description: 'Product price (minimum 0.01)' })
  @IsNumber()
  @Min(0.01)
  price: number

  @ApiProperty({ example: 100, description: 'Available quantity (minimum 0)' })
  @IsNumber()
  @Min(0)
  quantity: number
}
