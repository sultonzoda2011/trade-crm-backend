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
   * Только для внутреннего использования сервисом — контроллер
   * перехватывает это значение, выставляет как httpOnly cookie
   * и НЕ возвращает клиенту в теле ответа.
   */
  refreshToken: string

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto
}
