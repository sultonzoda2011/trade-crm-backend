import { Role } from '../enums'
import { marketScope, NO_MARKET_SCOPE } from './market-scope.util'

describe('marketScope', () => {
	it('does not limit an admin', () => {
		expect(marketScope({ role: Role.ADMIN, marketId: undefined })).toBeUndefined()
		expect(marketScope({ role: Role.ADMIN, marketId: 'm1' })).toBeUndefined()
	})

	it('limits owners and sellers to their own market', () => {
		expect(marketScope({ role: Role.OWNER, marketId: 'm1' })).toBe('m1')
		expect(marketScope({ role: Role.SELLER, marketId: 'm1' })).toBe('m1')
	})

	it('gives staff without a market a scope that matches no market', () => {
		expect(marketScope({ role: Role.OWNER, marketId: undefined })).toBe(NO_MARKET_SCOPE)
		expect(marketScope({ role: Role.SELLER, marketId: undefined })).toBe(NO_MARKET_SCOPE)
	})
})
