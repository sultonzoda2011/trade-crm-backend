import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaymentType, TransactionType } from '../../enums'

class CreateTransactionItemDto {
  @ApiProperty({ example: 'product-uuid' })
  @IsUUID()
  productId: string

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity: number

  @ApiPropertyOptional({
    example: 0,
    description: 'Discount for this line item. Price itself is always taken from the product in the database, never from the client.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number

  @ApiPropertyOptional({
    example: 0,
    description: 'Markup for this line item — the opposite of discount, added on top of the product price. Can be set by any role. Only accumulates toward a payout balance when the transaction creator is a SELLER.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  markup?: number
}

export class CreateTransactionDto {
  @ApiPropertyOptional({ example: 'debtor-uuid', description: 'Debtor ID. Only used for DEBT transactions; ignored for SALE.' })
  @IsOptional()
  @IsUUID()
  debtorId?: string

  @ApiPropertyOptional({ example: 'Иван', description: 'Optional customer name for a SALE ("who it was sold to"). Not used for DEBT.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string

  @ApiProperty({ enum: TransactionType, example: TransactionType.SALE })
  @IsEnum(TransactionType)
  type: TransactionType

  @ApiProperty({ enum: PaymentType, example: PaymentType.CASH })
  @IsEnum(PaymentType)
  paymentType: PaymentType

  @ApiPropertyOptional({ description: 'Due date for a DEBT transaction' })
  @IsOptional()
  @IsDateString()
  dueDate?: string

  @ApiPropertyOptional({
    example: 'Заберёт завтра',
    description: 'Free-form note on the receipt (max 500 characters).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string

  @ApiPropertyOptional({
    example: 100,
    description:
      'Advance paid at the moment of a DEBT sale. Must be less than the total — the rest stays as debt, and a Payment is recorded for the advance. Not allowed for SALE (a SALE is always paid in full).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  paidAmount?: number

  @ApiProperty({ type: [CreateTransactionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionItemDto)
  items: CreateTransactionItemDto[]
}
