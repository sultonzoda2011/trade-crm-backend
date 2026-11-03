import { OmitType, PartialType } from '@nestjs/swagger'
import { CreateSellerDto } from './create-seller.dto'

/** Рынок продавца после создания не меняется: у него там вся история. */
export class UpdateSellerDto extends PartialType(OmitType(CreateSellerDto, ['marketId'] as const)) {}
