import { IsBoolean, IsOptional, IsUUID } from 'class-validator'
import { QueryBoolean } from '../../common/decorators/query-boolean.decorator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'

export class QueryMarketDto extends BaseQueryDto {
  @ApiPropertyOptional({ description: 'Filter by owner ID' })
  @IsOptional()
  @IsUUID()
  ownerId?: string

  @ApiPropertyOptional({ description: 'Only markets that have at least one user assigned' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  hasUsers?: boolean

  @ApiPropertyOptional({ description: 'Only markets that have at least one product' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  hasProducts?: boolean
}
