import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class CreateDebtorPaymentDto {
  @ApiProperty({ example: 500, description: 'Total amount the debtor brought; applied to the oldest debts first' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number

  @ApiPropertyOptional({ example: 'Наличными' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
