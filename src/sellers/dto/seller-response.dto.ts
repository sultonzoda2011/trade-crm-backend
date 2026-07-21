import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class SellerMarketDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  address: string
}

export class SellerResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  email: string

  @ApiProperty()
  role: string

  @ApiProperty()
  createdAt: string

  @ApiPropertyOptional({ type: SellerMarketDto })
  market?: SellerMarketDto
}
