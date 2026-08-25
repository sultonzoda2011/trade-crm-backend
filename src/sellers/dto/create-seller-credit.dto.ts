import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateSellerCreditDto {
  @ApiProperty({
    example: 50000,
    description:
      'Amount to pay out to the seller now. Can be less than the current balance — payouts can be made in parts.'
  })
  @IsNumber()
  @Min(0.01)
  amount: number

  @ApiPropertyOptional({ example: 'Выдано наличными за август' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
