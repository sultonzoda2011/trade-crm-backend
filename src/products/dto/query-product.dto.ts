import { IsBoolean, IsNumber, IsOptional, IsUUID, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'

export class QueryProductDto extends BaseQueryDto {
  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string

  @ApiPropertyOptional({ description: 'Return only products at or below their low-stock threshold' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStock?: boolean

  @ApiPropertyOptional({ description: 'Minimum price filter' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number

  @ApiPropertyOptional({ description: 'Maximum price filter' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number
}
