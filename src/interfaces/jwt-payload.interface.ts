import { Role } from '../enums'

export interface JwtPayload {
	sub: string
	email: string
	role: Role
	id: string
	name: string
	image?: string
	marketId?: string
}
