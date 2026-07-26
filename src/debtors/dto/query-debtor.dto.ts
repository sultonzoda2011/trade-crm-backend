import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'

export class QueryDebtorDto extends BaseQueryDto {
  @ApiPropertyOptional({ description: 'Only debtors with active/partial debts' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasActiveDebts?: boolean

  @ApiPropertyOptional({ description: 'Minimum total debt amount (sum of remainingAmount across all active debts)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minDebtAmount?: number

  @ApiPropertyOptional({ description: 'Maximum total debt amount' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxDebtAmount?: number
}
