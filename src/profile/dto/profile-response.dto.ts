import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class ProfileResponseDto {
	@ApiProperty()
	id: string

	@ApiProperty()
	name: string

	@ApiProperty()
	email: string

	@ApiPropertyOptional({ nullable: true })
	phone?: string | null

	@ApiPropertyOptional({ nullable: true })
	image?: string | null

	@ApiProperty()
	role: string

	@ApiPropertyOptional({ nullable: true })
	marketId?: string | null

	@ApiProperty()
	createdAt: string

	@ApiPropertyOptional({ nullable: true, description: 'When the password was last changed; null = never changed.' })
	passwordChangedAt?: string | null
}
