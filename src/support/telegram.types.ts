// Минимальные типы Telegram Bot API: только поля, которые читает поддержка.
// Webhook-тело намеренно не валидируется class-validator'ом (глобальный
// ValidationPipe с forbidNonWhitelisted отрезал бы любые поля Telegram).

export type BotName = 'support' | 'admin'

export interface TgUser {
	id: number
	is_bot?: boolean
	first_name?: string
	last_name?: string
	username?: string
	language_code?: string
}

export interface TgChat {
	id: number
	type: string
}

export interface TgPhotoSize {
	file_id: string
	width?: number
	height?: number
	file_size?: number
}

export interface TgFile {
	file_id: string
	file_name?: string
	mime_type?: string
	file_size?: number
}

export interface TgMessage {
	message_id: number
	from?: TgUser
	chat: TgChat
	date?: number
	text?: string
	caption?: string
	photo?: TgPhotoSize[]
	document?: TgFile
	voice?: TgFile
	audio?: TgFile
	video?: TgFile
	video_note?: TgFile
	sticker?: TgFile & { emoji?: string }
	location?: { latitude: number; longitude: number }
	contact?: { phone_number: string; first_name: string; last_name?: string }
	reply_to_message?: TgMessage
}

export interface TgCallbackQuery {
	id: string
	from: TgUser
	message?: TgMessage
	data?: string
}

export interface TgUpdate {
	update_id: number
	message?: TgMessage
	callback_query?: TgCallbackQuery
}

export interface TgInlineButton {
	text: string
	callback_data: string
}

export interface TgReplyMarkup {
	inline_keyboard?: TgInlineButton[][]
	keyboard?: { text: string }[][]
	resize_keyboard?: boolean
	is_persistent?: boolean
}
