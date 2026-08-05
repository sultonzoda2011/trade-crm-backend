import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsUUID } from 'class-validator'

export class UpdateTransactionDto {
  @ApiPropertyOptional({ example: 'debtor-uuid' })
  @IsOptional()
  @IsUUID()
  debtorId?: string

  @ApiPropertyOptional({ description: 'Due date for a DEBT transaction' })
  @IsOptional()
  @IsDateString()
  dueDate?: string
}
