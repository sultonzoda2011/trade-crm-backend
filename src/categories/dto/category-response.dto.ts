import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CategoryResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiPropertyOptional()
  description?: string

  @ApiPropertyOptional()
  image?: string

  @ApiPropertyOptional({ description: 'Color label key (blue, green, …) or null' })
  color?: string | null

  @ApiProperty({ description: 'Position set by the owner: lower is higher in the list' })
  sortOrder: number

  @ApiProperty()
  marketId: string

  @ApiProperty()
  createdAt: string

  @ApiProperty()
  updatedAt: string

  @ApiPropertyOptional({ description: 'products = active products only' })
  _count?: { products: number }

  @ApiPropertyOptional({ description: 'Archived products that still belong to the category' })
  archivedCount?: number

  @ApiPropertyOptional({ description: 'Active products at or below their low-stock threshold (not out of stock)' })
  lowStockCount?: number

  @ApiPropertyOptional({ description: 'Active products with zero stock' })
  outOfStockCount?: number

  @ApiPropertyOptional({ description: 'Stock value at retail price. Owner/admin only' })
  stockValue?: number
}
