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

  @ApiProperty()
  amount: number

  @ApiPropertyOptional()
  note?: string

  @ApiProperty()
  createdAt: string

  @ApiPropertyOptional({ type: SellerCreditUserDto })
  createdBy?: SellerCreditUserDto
}
