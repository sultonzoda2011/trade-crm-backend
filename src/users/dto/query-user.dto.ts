import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator'
import { Type } from 'class-transformer'
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
  @Type(() => Boolean)
  @IsBoolean()
  isOwner?: boolean
}
