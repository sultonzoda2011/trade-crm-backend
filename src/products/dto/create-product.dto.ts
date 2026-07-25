import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ProductUnit } from '../../enums'

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

  @ApiPropertyOptional({ enum: ProductUnit, example: ProductUnit.PCS, description: 'Unit of measurement' })
  @IsOptional()
  @IsEnum(ProductUnit)
  unit?: ProductUnit

  @ApiPropertyOptional({ example: 10, description: 'Quantity threshold below which the product is considered low on stock' })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number

  @ApiPropertyOptional({ description: 'Category ID within the same market' })
  @IsOptional()
  @IsUUID()
  categoryId?: string
}
