import { IsBoolean, IsOptional, IsUUID } from 'class-validator'
import { Transform } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { toBoolean } from '../../products/dto/query-product.dto'

export class DeleteCategoryQueryDto {
  @ApiPropertyOptional({ description: 'Move all products (including archived) to this category, then delete' })
  @IsOptional()
  @IsUUID()
  moveTo?: string

  @ApiPropertyOptional({ description: 'true — keep the products, just leave them without a category' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  detach?: boolean
}
