import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class SellerCreditUserDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string
}

export class SellerCreditResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  sellerId: string

  @ApiProperty({ description: 'Negative for a cancellation entry.' })
  amount: number

  @ApiPropertyOptional()
  note?: string

  @ApiProperty()
  createdAt: string

  @ApiPropertyOptional({ type: SellerCreditUserDto })
  createdBy?: SellerCreditUserDto

  @ApiPropertyOptional({ description: 'Set on a cancellation entry: the payout it cancels.' })
  reversalOfId?: string | null

  @ApiProperty({ description: 'true when this payout has been cancelled.' })
  isReversed: boolean
}
