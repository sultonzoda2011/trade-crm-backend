import { IsBoolean, IsOptional } from 'class-validator'
import { Transform } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'
import { toBoolean } from '../../products/dto/query-product.dto'

export class QueryCategoryDto extends BaseQueryDto {
  @ApiPropertyOptional({
    description: 'Filter categories that have active products (true) or are empty (false)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasProducts?: boolean
}
