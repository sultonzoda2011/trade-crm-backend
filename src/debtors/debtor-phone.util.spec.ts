import { isValidPhone, normalizePhone } from './debtor-phone.util'

describe('normalizePhone', () => {
	it('strips spaces, brackets and dashes but keeps the leading plus', () => {
		expect(normalizePhone('+992 (90) 123-45-67')).toBe('+992901234567')
	})

	it('leaves a local number without plus as digits', () => {
		expect(normalizePhone('90 123 45 67')).toBe('901234567')
	})

	it('makes differently typed copies of one number equal', () => {
		expect(normalizePhone('+992901234567')).toBe(normalizePhone('+992 90 123-45-67'))
	})
})

describe('isValidPhone', () => {
	it('accepts 7-15 digits', () => {
		expect(isValidPhone('+9929012')).toBe(true)
		expect(isValidPhone('+992901234567')).toBe(true)
	})

	it('rejects too short and too long numbers', () => {
		expect(isValidPhone('12345')).toBe(false)
		expect(isValidPhone('1234567890123456')).toBe(false)
	})
})
