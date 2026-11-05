import { normalizeMessage, previewOf } from './support-message.util'
import { TgMessage } from './telegram.types'

const base = { message_id: 1, chat: { id: 10, type: 'private' } }

describe('normalizeMessage', () => {
	it('text', () => {
		expect(normalizeMessage({ ...base, text: 'привет' })).toEqual({
			kind: 'text',
			text: 'привет'
		})
	})

	it('photo: takes the largest size and keeps the caption', () => {
		const msg: TgMessage = {
			...base,
			caption: 'чек',
			photo: [
				{ file_id: 'small', file_size: 100 },
				{ file_id: 'big', file_size: 9000 },
				{ file_id: 'mid', file_size: 500 }
			]
		}
		expect(normalizeMessage(msg)).toMatchObject({
			kind: 'photo',
			fileId: 'big',
			text: 'чек'
		})
	})

	it.each([
		['document', { document: { file_id: 'd', file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 5 } }],
		['voice', { voice: { file_id: 'v' } }],
		['audio', { audio: { file_id: 'a' } }],
		['video', { video: { file_id: 'vi' } }],
		['video_note', { video_note: { file_id: 'vn' } }]
	])('%s is a file kind', (kind, extra) => {
		const result = normalizeMessage({ ...base, ...extra } as TgMessage)
		expect(result?.kind).toBe(kind)
		expect(result?.fileId).toBeDefined()
	})

	it('document keeps name, mime and size', () => {
		const result = normalizeMessage({
			...base,
			document: { file_id: 'd', file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 5 }
		})
		expect(result).toMatchObject({ fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 5 })
	})

	it('sticker, location and contact', () => {
		expect(normalizeMessage({ ...base, sticker: { file_id: 's', emoji: '😀' } })).toEqual({
			kind: 'sticker',
			text: '😀'
		})
		expect(normalizeMessage({ ...base, location: { latitude: 1, longitude: 2 } })).toMatchObject({
			kind: 'location',
			latitude: 1,
			longitude: 2
		})
		expect(
			normalizeMessage({ ...base, contact: { phone_number: '+992', first_name: 'Али' } })
		).toMatchObject({ kind: 'contact', contact: { phone: '+992', firstName: 'Али' } })
	})

	it('unsupported types (poll, dice…) give null', () => {
		expect(normalizeMessage({ ...base, poll: {} } as unknown as TgMessage)).toBeNull()
		expect(normalizeMessage({ ...base })).toBeNull()
	})
})

describe('previewOf', () => {
	it('text is clipped, media gets a label', () => {
		expect(previewOf('text', 'a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`)
		expect(previewOf('photo', null)).toBe('[фото]')
		expect(previewOf('voice', 'привет')).toBe('[голосовое] привет')
	})
})
