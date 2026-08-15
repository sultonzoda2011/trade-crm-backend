import { IsBoolean, IsEnum, IsNumber, IsOptional, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'
import { DebtorRisk } from '../../enums'

export class QueryDebtorDto extends BaseQueryDto {
  @ApiPropertyOptional({ description: 'Only debtors with active/partial debts' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasActiveDebts?: boolean

  @ApiPropertyOptional({ description: 'Only debtors with overdue debts (dueDate < now)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overdue?: boolean

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

  @ApiPropertyOptional({
    enum: DebtorRisk,
    description:
      'Filter by computed repayment risk. Risk is derived from overdue share, days overdue, debt size relative to the market average, repayment history and payment activity.',
  })
  @IsOptional()
  @IsEnum(DebtorRisk)
  risk?: DebtorRisk
}
