import { IsBoolean, IsOptional, IsUUID } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'

export class QueryMarketDto extends BaseQueryDto {
  @ApiPropertyOptional({ description: 'Filter by owner ID' })
  @IsOptional()
  @IsUUID()
  ownerId?: string

  @ApiPropertyOptional({ description: 'Only markets that have at least one user assigned' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasUsers?: boolean

  @ApiPropertyOptional({ description: 'Only markets that have at least one product' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasProducts?: boolean
}
