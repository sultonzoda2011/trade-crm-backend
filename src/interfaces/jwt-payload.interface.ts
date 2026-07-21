import { Role } from '../enums'

export interface JwtPayload {
	sub: string
	email: string
	role: Role
	name: string
	marketId?: string
}
