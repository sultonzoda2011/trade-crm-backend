import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class ProductMarketDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  address: string
}

class ProductCountDto {
  @ApiProperty()
  transactionItems: number
}

export class ProductResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  price: number

  @ApiProperty()
  quantity: number

  @ApiProperty()
  marketId: string

  @ApiProperty()
  createdAt: string

  @ApiProperty()
  updatedAt: string

  @ApiPropertyOptional({ type: ProductMarketDto })
  market?: ProductMarketDto

  @ApiPropertyOptional({ type: ProductCountDto })
  _count?: ProductCountDto
}
