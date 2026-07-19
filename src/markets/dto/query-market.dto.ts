import { IsOptional, IsString } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationDto } from '../../common/dto/pagination.dto'

export class QueryMarketDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search by market name or address' })
  @IsOptional()
  @IsString()
  search?: string
}
