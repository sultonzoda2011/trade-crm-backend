import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { AllExceptionsFilter } from './http-exception.filter'

function run(exception: unknown) {
	const json = jest.fn()
	const status = jest.fn().mockReturnValue({ json })
	const host: any = { switchToHttp: () => ({ getResponse: () => ({ status }) }) }
	new AllExceptionsFilter().catch(exception, host)
	return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] }
}

describe('AllExceptionsFilter', () => {
	it('forwards a machine-readable code and details to the client', () => {
		const { status, body } = run(
			new ConflictException({ message: 'Stock changed', code: 'PRODUCT_STOCK_CHANGED', details: { currentQuantity: 7 } })
		)
		expect(status).toBe(409)
		expect(body.code).toBe('PRODUCT_STOCK_CHANGED')
		expect(body.details).toEqual({ currentQuantity: 7 })
		expect(body.message).toEqual(['Stock changed'])
	})

	it('keeps plain errors free of code/details', () => {
		const { body } = run(new NotFoundException('nope'))
		expect(body).not.toHaveProperty('code')
		expect(body).not.toHaveProperty('details')
	})

	it('ignores a non-string code', () => {
		const { body } = run(new BadRequestException({ message: 'x', code: 42 }))
		expect(body).not.toHaveProperty('code')
	})
})
