import { Injectable } from '@nestjs/common'
import { MAX_DOWNLOAD_BYTES, TelegramApi } from './telegram-api.service'
import {
	FileKind,
	NormalizedMessage,
	isFileKind
} from './support-message.util'
import { BotName, TgReplyMarkup } from './telegram.types'

export interface RelayOptions {
	from: BotName
	to: BotName
	chatId: number
	message: NormalizedMessage
	/** «#12 Имя» — метка, которая стоит в начале каждого сообщения клиента в Admin-боте. */
	prefix?: string
	/** Inline-кнопки: вешаются на последнее отправленное сообщение. */
	replyMarkup?: TgReplyMarkup
}

export interface RelayResult {
	/** message_id всех отправленных сообщений (метка + файл — это два сообщения). */
	messageIds: number[]
	/** file_id файла в боте-получателе (у файлов с такими же данными он другой). */
	fileId: string | null
	/** Файл не передан: больше лимита Telegram для ботов (20 МБ). */
	tooLarge: boolean
}

const TEXT_LIMIT = 4000 // с запасом от 4096
const CAPTION_LIMIT = 1024

const UPLOAD: Record<FileKind, { method: string; field: string; fallbackName: string }> = {
	photo: { method: 'sendPhoto', field: 'photo', fallbackName: 'photo.jpg' },
	document: { method: 'sendDocument', field: 'document', fallbackName: 'file' },
	voice: { method: 'sendVoice', field: 'voice', fallbackName: 'voice.ogg' },
	audio: { method: 'sendAudio', field: 'audio', fallbackName: 'audio.mp3' },
	video: { method: 'sendVideo', field: 'video', fallbackName: 'video.mp4' },
	video_note: {
		method: 'sendVideoNote',
		field: 'video_note',
		fallbackName: 'video_note.mp4'
	}
}

interface SentMessage {
	message_id: number
	photo?: { file_id: string }[]
	[key: string]: unknown
}

/**
 * Передаёт сообщение из чата одного бота в чат другого. Один и тот же file_id
 * нельзя использовать в другом боте, поэтому файлы скачиваются и загружаются
 * заново. Пользовательский текст отправляется БЕЗ parse_mode: клиент не может
 * подсунуть админу разметку или ссылку.
 */
@Injectable()
export class TelegramRelay {
	constructor(private readonly api: TelegramApi) {}

	async relay(options: RelayOptions): Promise<RelayResult> {
		const { message, prefix } = options
		const ids: number[] = []
		let fileId: string | null = null
		let tooLarge = false

		const withPrefix = (body: string | null): string =>
			prefix ? (body ? `${prefix}\n${body}` : prefix) : (body ?? '')

		const sendText = async (text: string, last: boolean) => {
			const chunks = chunk(text, TEXT_LIMIT)
			for (let i = 0; i < chunks.length; i++) {
				const sent = await this.api.call<SentMessage>(options.to, 'sendMessage', {
					chat_id: options.chatId,
					text: chunks[i],
					...(last && i === chunks.length - 1 && options.replyMarkup
						? { reply_markup: options.replyMarkup }
						: {})
				})
				ids.push(sent.message_id)
			}
		}

		switch (message.kind) {
			case 'text':
				await sendText(withPrefix(message.text), true)
				break

			case 'sticker':
				await sendText(withPrefix(`[стикер ${message.text ?? ''}]`.trim()), true)
				break

			case 'location': {
				if (prefix) await sendText(prefix, false)
				const sent = await this.api.call<SentMessage>(options.to, 'sendLocation', {
					chat_id: options.chatId,
					latitude: message.latitude,
					longitude: message.longitude,
					...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {})
				})
				ids.push(sent.message_id)
				break
			}

			case 'contact': {
				if (prefix) await sendText(prefix, false)
				const sent = await this.api.call<SentMessage>(options.to, 'sendContact', {
					chat_id: options.chatId,
					phone_number: message.contact?.phone,
					first_name: message.contact?.firstName,
					last_name: message.contact?.lastName,
					...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {})
				})
				ids.push(sent.message_id)
				break
			}

			default: {
				if (!isFileKind(message.kind) || !message.fileId) {
					throw new Error(`Unsupported message kind: ${message.kind}`)
				}
				if ((message.fileSize ?? 0) > MAX_DOWNLOAD_BYTES) {
					tooLarge = true
					const mb = Math.round((message.fileSize ?? 0) / 1024 / 1024)
					await sendText(
						withPrefix(
							`[файл слишком большой для передачи: ${mb} МБ, лимит 20 МБ]${
								message.text ? `\n${message.text}` : ''
							}`
						),
						true
					)
					break
				}

				const spec = UPLOAD[message.kind]
				const data = await this.api.downloadFile(options.from, message.fileId)

				// Подпись влезает в 1024 символа — идёт под файлом. Иначе (и для
				// «кружка», у которого подписи нет) метка и текст — отдельным сообщением.
				const caption = withPrefix(message.text)
				const inlineCaption =
					message.kind !== 'video_note' && caption.length > 0 && caption.length <= CAPTION_LIMIT
				if (!inlineCaption && caption) await sendText(caption, false)

				const sent = await this.api.sendFile<SentMessage>(
					options.to,
					spec.method,
					spec.field,
					{
						data,
						filename: message.fileName ?? spec.fallbackName,
						contentType: message.mimeType
					},
					{
						chat_id: options.chatId,
						...(inlineCaption ? { caption } : {}),
						...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {})
					}
				)
				ids.push(sent.message_id)
				fileId = extractFileId(message.kind, sent)
			}
		}

		return { messageIds: ids, fileId, tooLarge }
	}
}

function extractFileId(kind: FileKind, sent: SentMessage): string | null {
	if (kind === 'photo') {
		const sizes = sent.photo
		return sizes && sizes.length > 0 ? sizes[sizes.length - 1].file_id : null
	}
	const file = sent[kind] as { file_id?: string } | undefined
	return file?.file_id ?? null
}

function chunk(text: string, size: number): string[] {
	if (text.length <= size) return [text]
	const parts: string[] = []
	for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size))
	return parts
}
