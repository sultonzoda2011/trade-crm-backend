import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class MarketOwnerDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  email: string

  @ApiPropertyOptional()
  role?: string
}

class MarketUserDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  email: string

  @ApiProperty()
  role: string
}

class MarketCountDto {
  @ApiProperty()
  products: number

  @ApiProperty()
  debtors: number

  @ApiProperty()
  transactions: number
}

export class MarketResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  address: string

  @ApiProperty()
  ownerId: string

  @ApiProperty()
  createdAt: string

  @ApiProperty()
  updatedAt: string

  @ApiPropertyOptional({ type: [MarketUserDto] })
  users?: MarketUserDto[]

  @ApiPropertyOptional({ type: MarketCountDto })
  count?: MarketCountDto

  @ApiPropertyOptional({ type: MarketOwnerDto })
  owner?: MarketOwnerDto
}
