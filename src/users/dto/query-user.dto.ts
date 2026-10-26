import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator'
import { QueryBoolean } from '../../common/decorators/query-boolean.decorator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BaseQueryDto } from '../../common/dto/base-query.dto'
import { Role } from '../../enums'

export class QueryUserDto extends BaseQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role

  @ApiPropertyOptional({ description: 'Filter by assigned market' })
  @IsOptional()
  @IsUUID()
  marketId?: string

  @ApiPropertyOptional({ description: 'Only users who own at least one market' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  isOwner?: boolean
}
