import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { QueryProductDto } from './query-product.dto'

const parse = (plain: Record<string, unknown>) =>
	plainToInstance(QueryProductDto, plain, { enableImplicitConversion: true })

describe('QueryProductDto boolean flags', () => {
	it('reads the string "false" as false (not as a non-empty truthy string)', () => {
		const dto = parse({ lowStock: 'false', needsReorder: 'false', archived: 'false' })
		expect(dto.lowStock).toBe(false)
		expect(dto.needsReorder).toBe(false)
		expect(dto.archived).toBe(false)
		expect(validateSync(dto)).toHaveLength(0)
	})

	it('reads the string "true" as true', () => {
		const dto = parse({ lowStock: 'true', archived: 'true' })
		expect(dto.lowStock).toBe(true)
		expect(dto.archived).toBe(true)
	})

	it('validates the rolling window range', () => {
		expect(validateSync(parse({ days: '30' }))).toHaveLength(0)
		expect(validateSync(parse({ days: '0' }))).not.toHaveLength(0)
		expect(validateSync(parse({ days: '400' }))).not.toHaveLength(0)
	})
})
