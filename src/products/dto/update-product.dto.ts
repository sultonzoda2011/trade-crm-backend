import { OmitType, PartialType } from '@nestjs/swagger'
import { CreateProductDto } from './create-product.dto'

// quantity намеренно нет: остаток меняется только действиями «Пополнить»,
// «Списать» и «Инвентаризация» (см. ProductsService), каждое пишет движение в
// журнал. PATCH с quantity молча затирал бы продажи, прошедшие за время правки.
export class UpdateProductDto extends PartialType(
	OmitType(CreateProductDto, ['quantity'] as const)
) {}
