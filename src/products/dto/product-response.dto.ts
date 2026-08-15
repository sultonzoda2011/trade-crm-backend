import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class ProductMarketDto {
  @ApiProperty({ description: 'Market ID' })
  id: string

  @ApiProperty({ description: 'Market name' })
  name: string

  @ApiProperty({ description: 'Market address' })
  address: string

  @ApiPropertyOptional({ description: 'Market image URL' })
  image?: string
}

class ProductCategoryDto {
  @ApiProperty({ description: 'Category ID' })
  id: string

  @ApiProperty({ description: 'Category name' })
  name: string

  @ApiPropertyOptional({ description: 'Category image URL' })
  image?: string
}

class ProductCountDto {
  @ApiProperty({ description: 'Total transaction items count' })
  transactionItems: number
}

class ProductSalesDto {
  @ApiProperty({ description: 'Number of sale transactions containing this product' })
  count: number

  @ApiProperty({ description: 'Total units sold across all sales' })
  unitsSold: number

  @ApiProperty({ description: 'Total revenue from sales' })
  revenue: number
}

export class ProductResponseDto {
  @ApiProperty({ description: 'Unique identifier' })
  id: string

  @ApiProperty({ description: 'Product name' })
  name: string

  @ApiPropertyOptional({ description: 'Product description' })
  description?: string

  @ApiProperty({ description: 'Product price' })
  price: number

  @ApiProperty({ description: 'Available quantity' })
  quantity: number

  @ApiProperty({ description: 'Product unit', enum: ['PCS', 'KG', 'L', 'M', 'BOX'] })
  unit: 'PCS' | 'KG' | 'L' | 'M' | 'BOX'

  @ApiProperty({ description: 'Low stock threshold' })
  lowStockThreshold: number

  @ApiPropertyOptional({ description: 'Product image URL' })
  image?: string

  @ApiProperty({ description: 'Market ID this product belongs to' })
  marketId: string

  @ApiPropertyOptional({ description: 'Category ID' })
  categoryId?: string

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: string

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: string

  @ApiPropertyOptional({ type: ProductMarketDto, description: 'Market details' })
  market?: ProductMarketDto

  @ApiPropertyOptional({ type: ProductCategoryDto, description: 'Category details' })
  category?: ProductCategoryDto

  @ApiPropertyOptional({ type: ProductCountDto, description: 'Related items count' })
  _count?: ProductCountDto

  @ApiPropertyOptional({ type: ProductSalesDto, description: 'Sales statistics (detail endpoint only)' })
  sales?: ProductSalesDto
}
