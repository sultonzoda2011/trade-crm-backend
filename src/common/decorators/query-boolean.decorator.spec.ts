import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { QueryDebtorDto } from '../../debtors/dto/query-debtor.dto'
import { QueryCategoryDto } from '../../categories/dto/query-category.dto'
import { parseQueryBoolean } from './query-boolean.decorator'

// Те же настройки, что у глобального ValidationPipe в bootstrap.ts.
const parse = <T extends object>(cls: new () => T, plain: Record<string, unknown>) =>
	plainToInstance(cls, plain, { enableImplicitConversion: true })

describe('parseQueryBoolean', () => {
	it.each([
		[true, true],
		['true', true],
		['1', true],
		[false, false],
		['false', false],
		['0', false]
	])('%p → %p', (raw, expected) => {
		expect(parseQueryBoolean(raw)).toBe(expected)
	})

	it('оставляет непонятное значение как есть, чтобы IsBoolean вернул 400', () => {
		expect(parseQueryBoolean('abc')).toBe('abc')
		expect(parseQueryBoolean(undefined)).toBeUndefined()
	})
})

describe('булевы query-параметры через ValidationPipe-преобразование', () => {
	it('?hasActiveDebts=false остаётся false, а не превращается в true', () => {
		const dto = parse(QueryDebtorDto, { hasActiveDebts: 'false', overdue: 'false' })
		expect(dto.hasActiveDebts).toBe(false)
		expect(dto.overdue).toBe(false)
		expect(validateSync(dto)).toHaveLength(0)
	})

	it('?hasActiveDebts=true даёт true', () => {
		const dto = parse(QueryDebtorDto, { hasActiveDebts: 'true' })
		expect(dto.hasActiveDebts).toBe(true)
	})

	it('отсутствующий параметр остаётся undefined', () => {
		const dto = parse(QueryCategoryDto, {})
		expect(dto.hasProducts).toBeUndefined()
		expect(validateSync(dto)).toHaveLength(0)
	})

	it('мусорное значение не проходит валидацию', () => {
		const dto = parse(QueryCategoryDto, { hasProducts: 'maybe' })
		expect(validateSync(dto)).not.toHaveLength(0)
	})
})
