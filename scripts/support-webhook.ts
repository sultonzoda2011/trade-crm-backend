/**
 * Регистрирует webhook'и Telegram-поддержки (один раз после деплоя бэкенда).
 *
 *   npm run support:webhook              — установить webhook'и обоих ботов
 *   npm run support:webhook -- --info    — показать состояние (без секретов)
 *   npm run support:webhook -- --delete  — снять webhook'и
 *
 * Читает из env (локальный .env или переменные shell):
 *   SUPPORT_PUBLIC_URL      https://<домен бэкенда>, без «/api» и без слэша на конце
 *   SUPPORT_BOT_TOKEN, ADMIN_BOT_TOKEN
 *   SUPPORT_WEBHOOK_SECRET, ADMIN_WEBHOOK_SECRET
 * Токены и секреты в вывод не попадают.
 */
import 'dotenv/config'

type Bot = {
	name: 'support' | 'admin'
	token?: string
	secret?: string
}

const bots: Bot[] = [
	{
		name: 'support',
		token: process.env.SUPPORT_BOT_TOKEN,
		secret: process.env.SUPPORT_WEBHOOK_SECRET
	},
	{
		name: 'admin',
		token: process.env.ADMIN_BOT_TOKEN,
		secret: process.env.ADMIN_WEBHOOK_SECRET
	}
]

async function call(bot: Bot, method: string, body: Record<string, unknown> = {}) {
	const response = await fetch(`https://api.telegram.org/bot${bot.token}/${method}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})
	const payload = (await response.json()) as {
		ok: boolean
		result?: Record<string, unknown>
		description?: string
	}
	if (!payload.ok) throw new Error(payload.description ?? `HTTP ${response.status}`)
	return payload.result ?? {}
}

async function main() {
	const mode = process.argv.includes('--info')
		? 'info'
		: process.argv.includes('--delete')
			? 'delete'
			: 'set'
	const baseUrl = process.env.SUPPORT_PUBLIC_URL?.replace(/\/+$/, '')

	if (mode === 'set' && !baseUrl) {
		throw new Error('SUPPORT_PUBLIC_URL is not set (e.g. https://your-backend.vercel.app)')
	}

	for (const bot of bots) {
		if (!bot.token) {
			console.log(`[${bot.name}] skipped: token is not set`)
			continue
		}
		try {
			if (mode === 'set') {
				if (!bot.secret) {
					console.log(`[${bot.name}] skipped: webhook secret is not set`)
					continue
				}
				await call(bot, 'setWebhook', {
					url: `${baseUrl}/api/telegram/${bot.name}/webhook`,
					secret_token: bot.secret,
					allowed_updates: ['message', 'callback_query'],
					max_connections: 5
				})
				console.log(`[${bot.name}] webhook set: ${baseUrl}/api/telegram/${bot.name}/webhook`)
			} else if (mode === 'delete') {
				await call(bot, 'deleteWebhook')
				console.log(`[${bot.name}] webhook deleted`)
			}
			if (mode !== 'delete') {
				const info = await call(bot, 'getWebhookInfo')
				console.log(
					`[${bot.name}] url=${info.url || '(none)'} pending=${info.pending_update_count ?? 0}` +
						(info.last_error_message ? ` lastError="${info.last_error_message}"` : '')
				)
			}
		} catch (error) {
			console.error(`[${bot.name}] failed: ${(error as Error).message}`)
			process.exitCode = 1
		}
	}
}

main().catch((error) => {
	console.error((error as Error).message)
	process.exit(1)
})
