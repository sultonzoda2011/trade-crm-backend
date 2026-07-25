import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
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
  @IsNumber()
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
}

export class CreateTransactionDto {
  @ApiPropertyOptional({ example: 'debtor-uuid' })
  @IsOptional()
  @IsUUID()
  debtorId?: string

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

  @ApiProperty({ type: [CreateTransactionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionItemDto)
  items: CreateTransactionItemDto[]
}
