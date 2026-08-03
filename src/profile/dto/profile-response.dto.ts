import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class ProfileResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  email: string

  @ApiPropertyOptional()
  image?: string

  @ApiProperty()
  role: string

  @ApiPropertyOptional()
  marketId?: string

  @ApiProperty()
  createdAt: string
}