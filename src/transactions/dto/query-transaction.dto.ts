import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { TransactionStatus, TransactionType } from '../../enums'
import { PaginationDto } from '../../common/dto/pagination.dto'

export class QueryTransactionDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  debtorId?: string

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
  @IsDateString()
  dateFrom?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string
}
