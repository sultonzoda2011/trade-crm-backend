import { normalizeEmail } from '../common/utils/email.util'

/**
 * Ключ лимита для входа: IP + email, а не один IP.
 *
 * На рынке все сотрудники сидят за одним Wi-Fi (или за одним адресом
 * мобильного оператора), и общий лимит «5 в минуту на IP» блокировал бы их друг
 * друга. Теперь у каждого аккаунта своя корзина: подбор пароля к одному
 * аккаунту всё так же упирается в лимит, а соседи по сети не страдают.
 * Общий лимит на IP для всего API (100 в минуту) остаётся.
 */
export function loginThrottleTracker(req: Record<string, any>): string {
	const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : ''
	return `${req.ip ?? 'unknown'}|${email}`
}
