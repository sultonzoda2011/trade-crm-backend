import { IsEnum, IsOptional } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { PeriodQueryDto } from '../../common/dto/period-query.dto'
import { SellerStatusFilter } from './query-seller.dto'

export class QuerySellerSummaryDto extends PeriodQueryDto {
  @ApiPropertyOptional({ enum: SellerStatusFilter, description: 'Default: active' })
  @IsOptional()
  @IsEnum(SellerStatusFilter)
  status?: SellerStatusFilter
}
