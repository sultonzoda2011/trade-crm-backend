import { IsDateString, IsOptional } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class QueryDashboardDto {
  @ApiPropertyOptional({ description: 'Start of period for period-scoped stats (sales report by seller, etc.)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string

  @ApiPropertyOptional({ description: 'End of period for period-scoped stats' })
  @IsOptional()
  @IsDateString()
  dateTo?: string
}
