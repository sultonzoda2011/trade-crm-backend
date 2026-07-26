import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export enum DashboardPeriod {
  TODAY = 'today',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

export class QueryDashboardDto {
  @ApiPropertyOptional({ description: 'Start of period for period-scoped stats' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string

  @ApiPropertyOptional({ description: 'End of period for period-scoped stats' })
  @IsOptional()
  @IsDateString()
  dateTo?: string

  @ApiPropertyOptional({ enum: DashboardPeriod, description: 'Predefined period (overrides dateFrom/dateTo)' })
  @IsOptional()
  @IsEnum(DashboardPeriod)
  period?: DashboardPeriod

  @ApiPropertyOptional({ description: 'Filter by seller (createdById)' })
  @IsOptional()
  @IsUUID()
  sellerId?: string
}
