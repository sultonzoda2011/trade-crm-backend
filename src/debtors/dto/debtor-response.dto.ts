import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class DebtorMarketDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  address: string
}

class DebtorCountDto {
  @ApiProperty()
  transactions: number
}

export class DebtorResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  phone: string

  @ApiProperty()
  marketId: string

  @ApiProperty()
  createdAt: string

  @ApiProperty()
  updatedAt: string

  @ApiPropertyOptional({ nullable: true })
  note?: string | null

  @ApiPropertyOptional({ nullable: true })
  creditLimit?: number | null

  @ApiPropertyOptional({ nullable: true })
  defaultDueDays?: number | null

  @ApiPropertyOptional({ nullable: true })
  lastRemindedAt?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'Another debtor with the same phone, if any (warning only)' })
  phoneDuplicateOf?: { id: string; name: string } | null

  @ApiPropertyOptional({ type: DebtorMarketDto })
  market?: DebtorMarketDto

  @ApiPropertyOptional({ type: DebtorCountDto })
  _count?: DebtorCountDto
}
