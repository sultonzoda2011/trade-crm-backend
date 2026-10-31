import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { MAX_STOCK } from '../stock.util'

export { MAX_STOCK }

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

	@ApiPropertyOptional({
		example: 'Поставка от Азиз-ака',
		description: 'Optional note shown in the stock history (max 200 chars)'
	})
	@IsOptional()
	@IsString()
	@MaxLength(200)
	note?: string
}
