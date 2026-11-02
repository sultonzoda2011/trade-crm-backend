import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class ReorderCategoriesDto {
  @ApiProperty({
    type: [String],
    description: 'Category ids in the desired order. Categories not listed keep their relative order after these',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[]
}
