import { Transform } from 'class-transformer'
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { CATEGORY_COLORS } from '../category-colors'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class CreateCategoryDto {
  @ApiProperty({ example: 'Beverages' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string

  @ApiPropertyOptional({ example: 'Soft drinks and juices' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @ApiPropertyOptional({
    enum: CATEGORY_COLORS,
    description: 'Color label key. Empty string clears the color on update',
  })
  @IsOptional()
  @IsIn([...CATEGORY_COLORS, ''])
  color?: string
}
