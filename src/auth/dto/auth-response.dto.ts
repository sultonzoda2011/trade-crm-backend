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

  /**
   * Клиент хранит это сам (localStorage) и отправляет токен дальше как
   * `Authorization: Bearer <accessToken>`. Cookie не используются.
   */

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto
}
