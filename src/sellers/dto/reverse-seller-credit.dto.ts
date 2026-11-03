import { IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class ReverseSellerCreditDto {
  @ApiPropertyOptional({ example: 'Ошиблись суммой', description: 'Why the payout is cancelled.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
