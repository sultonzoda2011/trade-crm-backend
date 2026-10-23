import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, Max, Min } from 'class-validator'

/**
 * Потолок и для одного пополнения, и для остатка после него. `Product.quantity`
 * — Int (до ~2.1 млрд), так что запас по переполнению остаётся с большим
 * зазором, а опечатка вроде лишних нулей отсекается сразу.
 */
export const MAX_STOCK = 1_000_000_000

export class RestockProductDto {
	@ApiProperty({
		example: 50,
		description: `How many units to ADD to the current stock (1 – ${MAX_STOCK}). Not the new total.`
	})
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_STOCK)
	quantity: number
}
