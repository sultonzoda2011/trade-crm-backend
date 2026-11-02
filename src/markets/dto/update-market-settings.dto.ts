import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional } from 'class-validator'

/** Настройки рынка. Меняет владелец своего рынка или админ. */
export class UpdateMarketSettingsDto {
  @ApiPropertyOptional({
    description:
      'May sellers record regular sales (cash/card), not only debts? Default false: sellers record debts only.',
  })
  @IsOptional()
  @IsBoolean()
  allowSellerSales?: boolean
}
