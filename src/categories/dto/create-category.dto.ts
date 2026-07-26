import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateCategoryDto {
  @ApiProperty({ example: 'Beverages' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string

  @ApiPropertyOptional({ example: 'Soft drinks and juices' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string
}
