import { Injectable } from '@nestjs/common'
import { SupportConfig } from './support.config'
import { BotName } from './telegram.types'

/**
 * Ошибка Bot API. Сообщение никогда не содержит URL: в нём лежит токен бота,
 * а исключения fetch/undici и HTTP-клиентов любят цитировать адрес запроса.
 */
export class TelegramApiError extends Error {
	constructor(
		readonly method: string,
		readonly code: number,
		description: string,
		readonly retryAfter?: number
	) {
		super(`Telegram ${method}: ${code} ${description}`)
		this.name = 'TelegramApiError'
	}
}

interface TgResponse<T> {
	ok: boolean
	result?: T
	error_code?: number
	description?: string
	parameters?: { retry_after?: number }
}

export interface UploadFile {
	data: Buffer
	filename: string
	contentType?: string
}

const CALL_TIMEOUT_MS = 15_000
const FILE_TIMEOUT_MS = 25_000
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024 // лимит getFile для ботов

@Injectable()
export class TelegramApi {
	constructor(private readonly config: SupportConfig) {}

	call<T = unknown>(
		bot: BotName,
		method: string,
		params: Record<string, unknown> = {}
	): Promise<T> {
		return this.request<T>(bot, method, {
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(params)
		})
	}

	/** Отправка файла (multipart): `field` — имя поля («photo», «document»…). */
	sendFile<T = unknown>(
		bot: BotName,
		method: string,
		field: string,
		file: UploadFile,
		params: Record<string, unknown> = {}
	): Promise<T> {
		const form = new FormData()
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) continue
			form.append(
				key,
				typeof value === 'object' ? JSON.stringify(value) : String(value)
			)
		}
		form.append(
			field,
			new Blob([new Uint8Array(file.data)], {
				type: file.contentType ?? 'application/octet-stream'
			}),
			file.filename
		)
		return this.request<T>(bot, method, { body: form }, FILE_TIMEOUT_MS)
	}

	/** Скачивает файл по file_id через getFile (до 20 МБ). */
	async downloadFile(bot: BotName, fileId: string): Promise<Buffer> {
		const info = await this.call<{ file_path?: string; file_size?: number }>(
			bot,
			'getFile',
			{ file_id: fileId }
		)
		if (!info.file_path) {
			throw new TelegramApiError('getFile', 400, 'file_path is missing')
		}
		if ((info.file_size ?? 0) > MAX_DOWNLOAD_BYTES) {
			throw new TelegramApiError('getFile', 400, 'file is too big')
		}
		const token = this.requireToken(bot)
		let response: Response
		try {
			response = await fetch(
				`https://api.telegram.org/file/bot${token}/${info.file_path}`,
				{ signal: AbortSignal.timeout(FILE_TIMEOUT_MS) }
			)
		} catch {
			throw new TelegramApiError('download', 0, 'network error')
		}
		if (!response.ok) {
			throw new TelegramApiError('download', response.status, 'download failed')
		}
		return Buffer.from(await response.arrayBuffer())
	}

	private async request<T>(
		bot: BotName,
		method: string,
		init: { headers?: Record<string, string>; body: string | FormData },
		timeoutMs = CALL_TIMEOUT_MS
	): Promise<T> {
		const token = this.requireToken(bot)
		let response: Response
		try {
			response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
				method: 'POST',
				headers: init.headers,
				body: init.body,
				signal: AbortSignal.timeout(timeoutMs)
			})
		} catch {
			throw new TelegramApiError(method, 0, 'network error')
		}

		let payload: TgResponse<T>
		try {
			payload = (await response.json()) as TgResponse<T>
		} catch {
			throw new TelegramApiError(method, response.status, 'invalid response')
		}
		if (!payload.ok) {
			throw new TelegramApiError(
				method,
				payload.error_code ?? response.status,
				payload.description ?? 'request failed',
				payload.parameters?.retry_after
			)
		}
		return payload.result as T
	}

	private requireToken(bot: BotName): string {
		const token = this.config.token(bot)
		if (!token) {
			throw new TelegramApiError('config', 0, `${bot} bot token is not configured`)
		}
		return token
	}
}
