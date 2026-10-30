import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional } from 'class-validator'
import { StockMovementType } from '@prisma/client'
import { BaseQueryDto } from '../../common/dto/base-query.dto'

export class QueryMovementsDto extends BaseQueryDto {
	@ApiPropertyOptional({ enum: StockMovementType, description: 'Filter by movement type' })
	@IsOptional()
	@IsEnum(StockMovementType)
	type?: StockMovementType
}
