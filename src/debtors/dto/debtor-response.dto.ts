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

  @ApiPropertyOptional({ type: DebtorMarketDto })
  market?: DebtorMarketDto

  @ApiPropertyOptional({ type: DebtorCountDto })
  _count?: DebtorCountDto
}
