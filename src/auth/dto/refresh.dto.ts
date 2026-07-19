import { IsString, IsUUID } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsUUID()
  refreshToken: string
}
