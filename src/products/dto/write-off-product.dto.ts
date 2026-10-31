import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { WriteOffReason } from '../../enums'
import { MAX_STOCK } from '../stock.util'

export class WriteOffProductDto {
	@ApiProperty({ example: 3, description: 'How many units to REMOVE from stock (1 – current stock)' })
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_STOCK)
	quantity: number

	@ApiProperty({ enum: WriteOffReason, example: WriteOffReason.DAMAGED })
	@IsEnum(WriteOffReason)
	reason: WriteOffReason

	@ApiPropertyOptional({ description: 'Optional note shown in the stock history (max 200 chars)' })
	@IsOptional()
	@IsString()
	@MaxLength(200)
	note?: string
}
