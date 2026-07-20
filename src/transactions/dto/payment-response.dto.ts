import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class PaymentUserDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  email: string
}

export class PaymentResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  transactionId: string

  @ApiProperty()
  amount: number

  @ApiPropertyOptional()
  note?: string

  @ApiProperty()
  createdAt: string

  @ApiPropertyOptional({ type: PaymentUserDto })
  createdBy?: PaymentUserDto
}
