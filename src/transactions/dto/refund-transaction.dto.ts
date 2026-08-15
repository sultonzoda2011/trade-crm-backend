import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class RefundItemDto {
  @ApiProperty({
    example: 'transaction-item-uuid',
    description:
      'Id of the ORIGINAL sale line to refund — not the product id. A sale may contain the same product on several lines with different discounts.',
  })
  @IsUUID()
  itemId: string

  @ApiProperty({ example: 2, description: 'How many units of this line to return' })
  @IsInt()
  @Min(1)
  quantity: number
}

export class RefundTransactionDto {
  @ApiPropertyOptional({
    type: [RefundItemDto],
    description:
      'Lines to refund. Omit entirely to refund the full remaining quantity of every line (backwards-compatible whole-transaction refund).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RefundItemDto)
  items?: RefundItemDto[]

  @ApiPropertyOptional({ description: 'Why the goods were returned' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
