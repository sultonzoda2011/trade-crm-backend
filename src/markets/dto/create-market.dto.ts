import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateMarketDto {
  @ApiProperty({ example: 'Central Market' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string

  @ApiProperty({ example: '123 Main St' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerId?: string
}
