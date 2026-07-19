import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class AuthUserDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  email: string

  @ApiProperty()
  role: string

  @ApiPropertyOptional()
  marketId?: string
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string

  @ApiProperty()
  refreshToken: string

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto
}
