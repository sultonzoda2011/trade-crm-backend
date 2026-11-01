import { Role } from '../enums'
import { JwtPayload } from '../interfaces'

/**
 * id, которого нет ни у одного рынка. Сотрудник без рынка получает его вместо
 * `undefined`: в сервисах `undefined` значит «без ограничений» (ADMIN), и
 * владелец/продавец без `marketId` иначе увидел бы все рынки.
 */
export const NO_MARKET_SCOPE = '00000000-0000-0000-0000-000000000000'

/**
 * Рынок, которым ограничен запрос: ADMIN видит все (`undefined`), OWNER и
 * SELLER — только свой. Чужой рынок для них — «не найден», а не «запрещён»
 * (см. IDOR-правило в AGENTS.md).
 */
export function marketScope(user: Pick<JwtPayload, 'role' | 'marketId'>): string | undefined {
	if (user.role === Role.ADMIN) return undefined
	return user.marketId ?? NO_MARKET_SCOPE
}
