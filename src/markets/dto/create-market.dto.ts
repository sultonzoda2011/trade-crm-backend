import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateMarketDto {
  @ApiProperty({ example: 'Central Market', description: 'Market name (2-200 characters)' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string

  @ApiProperty({ example: '123 Main St', description: 'Market address (5-500 characters)' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address: string

  @ApiPropertyOptional({ description: 'Owner user ID (defaults to current user)' })
  @IsOptional()
  @IsString()
  ownerId?: string
}
