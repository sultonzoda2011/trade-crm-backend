import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsEnum, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator'
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

  @ApiProperty({ example: 1.5 })
  @IsNumber()
  @Min(0.01)
  price: number
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

  @ApiProperty({ type: [CreateTransactionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionItemDto)
  items: CreateTransactionItemDto[]
}
