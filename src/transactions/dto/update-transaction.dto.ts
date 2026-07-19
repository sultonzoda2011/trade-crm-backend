import { PartialType, OmitType } from '@nestjs/swagger'
import { CreateTransactionDto } from './create-transaction.dto'

export class UpdateTransactionDto extends PartialType(
  OmitType(CreateTransactionDto, ['items'] as const),
) {}
