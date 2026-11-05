import { SupportConversation } from '@prisma/client'
import { TgInlineButton, TgReplyMarkup } from './telegram.types'

type ChatLike = Pick<
	SupportConversation,
	'number' | 'firstName' | 'lastName' | 'username' | 'telegramUserId'
>

export function displayName(conv: ChatLike): string {
	const full = [conv.firstName, conv.lastName].filter(Boolean).join(' ').trim()
	if (full) return full
	if (conv.username) return `@${conv.username}`
	return `id ${conv.telegramUserId}`
}

/** Метка в начале каждого сообщения клиента в Admin-боте: «#12 Имя (@user)». */
export function chatPrefix(conv: ChatLike): string {
	const name = displayName(conv)
	const handle = conv.username && name !== `@${conv.username}` ? ` (@${conv.username})` : ''
	return `#${conv.number} ${name}${handle}`
}

export function formatTime(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat('ru-RU', {
		timeZone,
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(date)
}

export function formatAgo(date: Date, now = new Date()): string {
	const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000))
	if (minutes < 1) return 'только что'
	if (minutes < 60) return `${minutes} мин назад`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours} ч назад`
	return `${Math.round(hours / 24)} дн назад`
}

/** Кнопки под последним сообщением клиента. */
export function chatKeyboard(
	conv: Pick<SupportConversation, 'number' | 'isBlocked'>
): TgReplyMarkup {
	const n = conv.number
	return {
		inline_keyboard: [
			[
				{ text: '💬 Ответить', callback_data: `r:${n}` },
				{ text: '✅ Готово', callback_data: `d:${n}` }
			],
			[
				{ text: '🗂 История', callback_data: `h:${n}:0` },
				{
					text: conv.isBlocked ? '🔓 Разблокировать' : '🚫 Заблокировать',
					callback_data: `b:${n}`
				}
			]
		]
	}
}

export const cancelKeyboard: TgReplyMarkup = {
	inline_keyboard: [[{ text: '✖️ Отмена', callback_data: 'c:0' }]]
}

/** Постоянные кнопки внизу Admin-бота (без слэш-команд). */
export const MENU_PENDING = '🔴 Требуют ответа'
export const MENU_ALL = '📋 Все чаты'
export const menuKeyboard: TgReplyMarkup = {
	keyboard: [[{ text: MENU_PENDING }, { text: MENU_ALL }]],
	resize_keyboard: true,
	is_persistent: true
}

export type CallbackAction = 'r' | 'd' | 'h' | 'b' | 'v' | 'c'

/** Разбирает callback_data вида `h:12:20`; чужие/битые данные дают null. */
export function parseCallback(
	data: string | undefined
): { action: CallbackAction; number: number; arg: number } | null {
	if (!data) return null
	const match = /^([rdhbvc]):(\d{1,9})(?::(\d{1,9}))?$/.exec(data)
	if (!match) return null
	return {
		action: match[1] as CallbackAction,
		number: Number(match[2]),
		arg: match[3] ? Number(match[3]) : 0
	}
}

export const listButtons = (
	rows: { number: number; label: string }[]
): TgInlineButton[][] =>
	rows.map((row) => [{ text: row.label, callback_data: `v:${row.number}` }])
