import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreatePaymentDto {
  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0.01)
  amount: number

  @ApiPropertyOptional({ example: 'Partial payment' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
