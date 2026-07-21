import { PartialType } from '@nestjs/swagger'
import { CreateSellerDto } from './create-seller.dto'

export class UpdateSellerDto extends PartialType(CreateSellerDto) {}
