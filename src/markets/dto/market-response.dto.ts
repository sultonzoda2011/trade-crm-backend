import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class MarketOwnerDto {
  @ApiProperty({ description: 'Owner ID' })
  id: string

  @ApiProperty({ description: 'Owner name' })
  name: string

  @ApiPropertyOptional({ description: 'Owner email. Not sent to sellers.' })
  email?: string

  @ApiPropertyOptional({ nullable: true, description: 'Owner phone' })
  phone?: string | null

  @ApiPropertyOptional({ description: 'Owner role' })
  role?: string
}

class MarketUserDto {
  @ApiProperty({ description: 'User ID' })
  id: string

  @ApiProperty({ description: 'User name' })
  name: string

  @ApiPropertyOptional({ description: 'User email. Not sent to sellers.' })
  email?: string

  @ApiPropertyOptional({ nullable: true, description: 'User phone' })
  phone?: string | null

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

  @ApiPropertyOptional({ nullable: true, description: 'Market phone' })
  phone?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'Working hours, free text' })
  workHours?: string | null

  @ApiProperty({ description: 'May sellers record regular sales (not only debts)?' })
  allowSellerSales: boolean

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

class MarketManagementSummaryDto {
  @ApiProperty({ description: 'Total outstanding debt of the market' })
  totalDebt: number

  @ApiProperty({ description: 'Part of the debt that is overdue' })
  overdueAmount: number

  @ApiProperty({ description: 'Debtors who owe something right now' })
  debtorsWithDebt: number

  @ApiProperty({ description: 'Stock value at retail (sale) prices, active products' })
  stockRetailValue: number

  @ApiProperty({ description: 'Stock value at cost prices (only products with a cost price)' })
  stockCostValue: number

  @ApiProperty({ description: 'Active products without a cost price (cost value is partial)' })
  productsWithoutCost: number

  @ApiProperty({ description: 'Active products that are out of stock' })
  outOfStock: number

  @ApiProperty({ description: 'Active products below their low-stock threshold' })
  lowStock: number
}

class MarketSummaryDto {
  @ApiProperty({ description: 'Active (not archived) products' })
  products: number

  @ApiProperty({ description: 'Debtors of the market' })
  debtors: number

  @ApiProperty({ description: 'Users with the SELLER role' })
  sellers: number

  @ApiProperty({ description: 'All transactions of the market' })
  transactions: number

  @ApiPropertyOptional({
    type: MarketManagementSummaryDto,
    nullable: true,
    description: 'Money and stock health. null for sellers.',
  })
  management: MarketManagementSummaryDto | null
}

export class MarketOverviewResponseDto {
  @ApiProperty({ type: MarketResponseDto })
  market: MarketResponseDto

  @ApiProperty({ type: MarketSummaryDto })
  summary: MarketSummaryDto
}
