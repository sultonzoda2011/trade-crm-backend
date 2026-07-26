import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class BaseQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string

  @ApiPropertyOptional({ example: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string

  @ApiPropertyOptional({ enum: ['asc', 'desc'], example: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'
}
