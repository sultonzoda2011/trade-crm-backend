import { ApiProperty } from '@nestjs/swagger'

export class SellerBalanceResponseDto {
  @ApiProperty()
  sellerId: string

  @ApiProperty({ description: 'Total markup earned across all SALE/DEBT items created by this seller.' })
  earned: number

  @ApiProperty({ description: 'Markup reversed by refunds of this seller\'s items.' })
  refunded: number

  @ApiProperty({ description: 'Total paid out to this seller, cancelled payouts already subtracted.' })
  paidOut: number

  @ApiProperty({
    description:
      'Owed to the seller: earned - refunded - paidOut. Negative means overpaid (e.g. an old receipt was deleted after the payout).'
  })
  balance: number

  @ApiProperty({
    description: 'Part of earned that sits in debts not fully repaid yet (status ACTIVE/PARTIAL). Informational.'
  })
  pendingInDebts: number
}
