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

  @ApiProperty()
  marketId: string

  @ApiProperty()
  createdAt: string

  @ApiProperty()
  updatedAt: string

  @ApiPropertyOptional()
  productsCount?: number
}
