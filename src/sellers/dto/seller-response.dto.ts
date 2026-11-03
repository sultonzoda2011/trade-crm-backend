import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class SellerMarketDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  address: string
}

class SellerStatsDto {
  @ApiProperty({ description: 'SALE + DEBT receipts in the period.' })
  salesCount: number

  @ApiProperty({ description: 'Sold in the period: SALE + DEBT totals minus refunds of this seller\'s sales.' })
  sold: number

  @ApiProperty({ description: 'Markup earned in the period, refunds subtracted.' })
  earned: number

  @ApiProperty({ description: 'Owed to the seller right now, all time. Negative = overpaid.' })
  balance: number

  @ApiProperty({ description: 'Part of the balance that sits in debts not repaid yet.' })
  pendingInDebts: number

  @ApiPropertyOptional({ nullable: true })
  lastSaleAt: string | null
}

export class SellerResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  email: string

  @ApiPropertyOptional({ nullable: true })
  phone?: string | null

  @ApiProperty()
  role: string

  @ApiProperty({ description: 'false — account is disabled: cannot log in, history is kept.' })
  isActive: boolean

  @ApiPropertyOptional({ nullable: true })
  deactivatedAt?: string | null

  @ApiPropertyOptional()
  image?: string

  @ApiProperty()
  createdAt: string

  @ApiPropertyOptional({ type: SellerMarketDto })
  market?: SellerMarketDto

  @ApiPropertyOptional({ type: SellerStatsDto, description: 'Present with ?withStats=true.' })
  stats?: SellerStatsDto
}
