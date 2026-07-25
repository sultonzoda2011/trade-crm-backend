import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class QueryProductDto {
  @ApiPropertyOptional({ example: 1, description: 'Page number (1-based)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ example: 20, description: 'Number of items per page (max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20

  @ApiPropertyOptional({ description: 'Search by product name' })
  @IsOptional()
  @IsString()
  search?: string

  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string

  @ApiPropertyOptional({ description: 'Return only products at or below their low-stock threshold' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStock?: boolean
}
