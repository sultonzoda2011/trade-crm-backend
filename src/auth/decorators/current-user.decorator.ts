import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { JwtPayload } from '../../interfaces'

export const CurrentUser = createParamDecorator(
  (key: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | JwtPayload[keyof JwtPayload] => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>()
    const user = request.user

    return key ? user?.[key] : user
  },
)
