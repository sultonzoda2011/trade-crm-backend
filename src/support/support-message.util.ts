import { TgMessage } from './telegram.types'

export type MessageKind =
	| 'text'
	| 'photo'
	| 'document'
	| 'voice'
	| 'audio'
	| 'video'
	| 'video_note'
	| 'sticker'
	| 'location'
	| 'contact'

/** Типы, которые передаются файлом (скачать у одного бота → загрузить другому). */
export const FILE_KINDS = [
	'photo',
	'document',
	'voice',
	'audio',
	'video',
	'video_note'
] as const
export type FileKind = (typeof FILE_KINDS)[number]

export const isFileKind = (kind: MessageKind): kind is FileKind =>
	(FILE_KINDS as readonly string[]).includes(kind)

export interface NormalizedMessage {
	kind: MessageKind
	/** Текст сообщения или подпись к файлу; у стикера — эмодзи. */
	text: string | null
	fileId?: string
	fileName?: string
	mimeType?: string
	fileSize?: number
	latitude?: number
	longitude?: number
	contact?: { phone: string; firstName: string; lastName?: string }
}

/**
 * Приводит сообщение Telegram к единому виду. `null` — тип не поддерживается
 * (опрос, кубик, игра, место и т. п.): бот честно скажет об этом.
 */
export function normalizeMessage(msg: TgMessage): NormalizedMessage | null {
	const caption = msg.caption?.trim() ? msg.caption : null

	if (typeof msg.text === 'string' && msg.text.length > 0) {
		return { kind: 'text', text: msg.text }
	}
	if (msg.photo && msg.photo.length > 0) {
		// Telegram присылает несколько размеров по возрастанию — берём самый большой.
		const largest = msg.photo.reduce((best, size) =>
			(size.file_size ?? 0) >= (best.file_size ?? 0) ? size : best
		)
		return {
			kind: 'photo',
			text: caption,
			fileId: largest.file_id,
			fileSize: largest.file_size
		}
	}
	const fileKinds: [FileKind, keyof TgMessage][] = [
		['document', 'document'],
		['voice', 'voice'],
		['audio', 'audio'],
		['video', 'video'],
		['video_note', 'video_note']
	]
	for (const [kind, key] of fileKinds) {
		const file = msg[key] as TgMessage['document']
		if (file) {
			return {
				kind,
				text: kind === 'video_note' ? null : caption,
				fileId: file.file_id,
				fileName: file.file_name,
				mimeType: file.mime_type,
				fileSize: file.file_size
			}
		}
	}
	if (msg.sticker) {
		return { kind: 'sticker', text: msg.sticker.emoji ?? null }
	}
	if (msg.location) {
		return {
			kind: 'location',
			text: null,
			latitude: msg.location.latitude,
			longitude: msg.location.longitude
		}
	}
	if (msg.contact) {
		return {
			kind: 'contact',
			text: null,
			contact: {
				phone: msg.contact.phone_number,
				firstName: msg.contact.first_name,
				lastName: msg.contact.last_name
			}
		}
	}
	return null
}

const KIND_LABELS: Record<MessageKind, string> = {
	text: 'текст',
	photo: 'фото',
	document: 'файл',
	voice: 'голосовое',
	audio: 'аудио',
	video: 'видео',
	video_note: 'кружок',
	sticker: 'стикер',
	location: 'геолокация',
	contact: 'контакт'
}

export const kindLabel = (kind: string): string =>
	KIND_LABELS[kind as MessageKind] ?? kind

/** Короткое описание для списков и истории: «текст…» или «[фото] подпись». */
export function previewOf(
	kind: string,
	text: string | null,
	maxLength = 120
): string {
	const body = (text ?? '').replace(/\s+/g, ' ').trim()
	const clipped =
		body.length > maxLength ? `${body.slice(0, maxLength - 1)}…` : body
	if (kind === 'text') return clipped
	return clipped ? `[${kindLabel(kind)}] ${clipped}` : `[${kindLabel(kind)}]`
}
