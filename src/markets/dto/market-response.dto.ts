import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class MarketOwnerDto {
  @ApiProperty({ description: 'Owner ID' })
  id: string

  @ApiProperty({ description: 'Owner name' })
  name: string

  @ApiProperty({ description: 'Owner email' })
  email: string

  @ApiPropertyOptional({ description: 'Owner role' })
  role?: string
}

class MarketUserDto {
  @ApiProperty({ description: 'User ID' })
  id: string

  @ApiProperty({ description: 'User name' })
  name: string

  @ApiProperty({ description: 'User email' })
  email: string

  @ApiProperty({ description: 'User role' })
  role: string
}

class MarketCountDto {
  @ApiProperty({ description: 'Total products count' })
  products: number

  @ApiProperty({ description: 'Total debtors count' })
  debtors: number

  @ApiProperty({ description: 'Total transactions count' })
  transactions: number
}

export class MarketResponseDto {
  @ApiProperty({ description: 'Unique identifier' })
  id: string

  @ApiProperty({ description: 'Market name' })
  name: string

  @ApiProperty({ description: 'Market address' })
  address: string

  @ApiPropertyOptional({ description: 'Market image URL' })
  image?: string

  @ApiProperty({ description: 'Owner user ID' })
  ownerId: string

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: string

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: string

  @ApiPropertyOptional({ type: [MarketUserDto], description: 'Market users' })
  users?: MarketUserDto[]

  @ApiPropertyOptional({ type: MarketCountDto, description: 'Related entities count' })
  count?: MarketCountDto

  @ApiPropertyOptional({ type: MarketOwnerDto, description: 'Market owner details' })
  owner?: MarketOwnerDto
}
