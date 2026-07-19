import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class ProductMarketDto {
  @ApiProperty({ description: 'Market ID' })
  id: string

  @ApiProperty({ description: 'Market name' })
  name: string

  @ApiProperty({ description: 'Market address' })
  address: string
}

class ProductCountDto {
  @ApiProperty({ description: 'Total transaction items count' })
  transactionItems: number
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

  @ApiPropertyOptional({ description: 'Product image URL' })
  image?: string

  @ApiProperty({ description: 'Market ID this product belongs to' })
  marketId: string

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: string

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: string

  @ApiPropertyOptional({ type: ProductMarketDto, description: 'Market details' })
  market?: ProductMarketDto

  @ApiPropertyOptional({ type: ProductCountDto, description: 'Related items count' })
  _count?: ProductCountDto
}
