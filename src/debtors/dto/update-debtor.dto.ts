import { PartialType } from '@nestjs/swagger'
import { CreateDebtorDto } from './create-debtor.dto'

export class UpdateDebtorDto extends PartialType(CreateDebtorDto) {}
