import { IsBoolean, IsOptional } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'

export class QueryCategoryDto extends BaseQueryDto {
  @ApiPropertyOptional({ description: 'Filter categories that have products (true) or are empty (false)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasProducts?: boolean
}
