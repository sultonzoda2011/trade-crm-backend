import { IsString, IsUUID } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LogoutDto {
  @ApiProperty()
  @IsString()
  @IsUUID()
  refreshToken: string
}
