import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class UpdateTransactionDto {
  @ApiPropertyOptional({ example: 'debtor-uuid' })
  @IsOptional()
  @IsUUID()
  debtorId?: string

  @ApiPropertyOptional({ description: 'Due date for a DEBT transaction' })
  @IsOptional()
  @IsDateString()
  dueDate?: string

  @ApiPropertyOptional({
    description:
      'Note on the receipt. Unlike the other fields it can be edited on a finalized transaction too — it does not affect any amounts.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
