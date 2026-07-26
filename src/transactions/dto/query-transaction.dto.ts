import { IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'
import { PaymentType, TransactionStatus, TransactionType } from '../../enums'

export class QueryTransactionDto extends BaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  debtorId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  createdById?: string

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string

  @ApiPropertyOptional({ enum: PaymentType })
  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minAmount?: number

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxAmount?: number
}
