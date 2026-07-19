import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class UserMarketDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  address: string
}

export class UserResponseDto {
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

  @ApiPropertyOptional({ type: UserMarketDto })
  market?: UserMarketDto
}
