import { Role } from '../enums'

export interface JwtPayload {
  sub: string
  email: string
  role: Role
  marketId?: string
}
