import { ApiProperty } from '@nestjs/swagger'

export class SellerBalanceResponseDto {
  @ApiProperty()
  sellerId: string

  @ApiProperty({ description: 'Total markup earned across all non-refunded SALE/DEBT items created by this seller.' })
  earned: number

  @ApiProperty({ description: 'Markup reversed by refunds of this seller\'s items.' })
  refunded: number

  @ApiProperty({ description: 'Total already paid out to this seller.' })
  paidOut: number

  @ApiProperty({ description: 'Current balance available to pay out: earned - refunded - paidOut.' })
  balance: number
}
