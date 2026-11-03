import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { QuerySellerDto } from './query-seller.dto'

const parse = (query: Record<string, unknown>) => {
	const dto = plainToInstance(QuerySellerDto, query, { enableImplicitConversion: true })
	return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) }
}

describe('QuerySellerDto', () => {
	it('?withStats=false stays false (a plain string would be truthy)', () => {
		expect(parse({ withStats: 'false' }).dto.withStats).toBe(false)
		expect(parse({ withStats: 'true' }).dto.withStats).toBe(true)
	})

	it('accepts the period and the status filter', () => {
		expect(parse({ period: 'week', status: 'disabled' }).errors).toHaveLength(0)
	})

	it('rejects an unknown status or period', () => {
		expect(parse({ status: 'fired' }).errors).not.toHaveLength(0)
		expect(parse({ period: 'decade' }).errors).not.toHaveLength(0)
	})
})
