import { CallHandler, ConflictException, ExecutionContext } from '@nestjs/common'
import { lastValueFrom, of, throwError } from 'rxjs'
import { IDEMPOTENCY_STALE_AFTER_MS, IdempotencyInterceptor } from './idempotency.interceptor'

// Реальный PrismaService тянет сгенерированный клиент и подключение к БД — тесту нужна только форма API.
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }))

const KEY = '0b7c1d3e-5a4f-4c1e-9d38-7a2d3f9e1a10'

function makeContext(headers: Record<string, string>, userId = 'user-1'): ExecutionContext {
	const request = { headers, user: { id: userId }, method: 'POST', route: { path: '/debtors' }, url: '/debtors' }
	return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext
}

function makePrisma() {
	return {
		idempotencyKey: {
			findUnique: jest.fn().mockResolvedValue(null),
			create: jest.fn().mockResolvedValue({}),
			update: jest.fn().mockResolvedValue({}),
			delete: jest.fn().mockResolvedValue({}),
			deleteMany: jest.fn().mockResolvedValue({ count: 1 })
		}
	}
}

const handler = (result: unknown): CallHandler => ({ handle: jest.fn(() => of(result)) })

describe('IdempotencyInterceptor', () => {
	let prisma: ReturnType<typeof makePrisma>
	let interceptor: IdempotencyInterceptor

	beforeEach(() => {
		prisma = makePrisma()
		interceptor = new IdempotencyInterceptor(prisma as never)
	})

	const run = async (ctx: ExecutionContext, next: CallHandler) => lastValueFrom(await interceptor.intercept(ctx, next))

	it('passes through without a key and never touches the table', async () => {
		const next = handler({ id: 'd1' })

		await expect(run(makeContext({}), next)).resolves.toEqual({ id: 'd1' })

		expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled()
		expect(prisma.idempotencyKey.create).not.toHaveBeenCalled()
	})

	it('reserves the key, runs the handler and stores the response before returning it', async () => {
		const next = handler({ id: 'd1' })

		await expect(run(makeContext({ 'idempotency-key': KEY }), next)).resolves.toEqual({ id: 'd1' })

		expect(prisma.idempotencyKey.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ key: KEY, userId: 'user-1', statusCode: 0 })
		})
		expect(prisma.idempotencyKey.update).toHaveBeenCalledWith({
			where: { key: KEY },
			data: { statusCode: 200, response: { id: 'd1' } }
		})
	})

	it('replays the stored response of a finished request without running the handler', async () => {
		prisma.idempotencyKey.findUnique.mockResolvedValue({
			key: KEY, userId: 'user-1', statusCode: 200, response: { id: 'd1' }, createdAt: new Date()
		})
		const next = handler({ id: 'second-debtor' })

		await expect(run(makeContext({ 'idempotency-key': KEY }), next)).resolves.toEqual({ id: 'd1' })

		expect(next.handle).not.toHaveBeenCalled()
	})

	// Пустой ответ клиент принял бы за успех и не получил бы id созданной записи.
	it('answers 409 (not an empty success) while the original request is still running', async () => {
		prisma.idempotencyKey.findUnique.mockResolvedValue({
			key: KEY, userId: 'user-1', statusCode: 0, response: {}, createdAt: new Date()
		})
		const next = handler({ id: 'x' })

		await expect(run(makeContext({ 'idempotency-key': KEY }), next)).rejects.toBeInstanceOf(ConflictException)

		expect(next.handle).not.toHaveBeenCalled()
	})

	it('takes over a reservation left behind by a crashed process', async () => {
		prisma.idempotencyKey.findUnique.mockResolvedValue({
			key: KEY, userId: 'user-1', statusCode: 0, response: {},
			createdAt: new Date(Date.now() - IDEMPOTENCY_STALE_AFTER_MS - 1000)
		})
		const next = handler({ id: 'd2' })

		await expect(run(makeContext({ 'idempotency-key': KEY }), next)).resolves.toEqual({ id: 'd2' })

		expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({ where: { key: KEY, statusCode: 0 } })
		expect(prisma.idempotencyKey.create).toHaveBeenCalled()
	})

	it('never replays one user\'s response to another user', async () => {
		prisma.idempotencyKey.findUnique.mockResolvedValue({
			key: KEY, userId: 'someone-else', statusCode: 200, response: { id: 'secret' }, createdAt: new Date()
		})
		const next = handler({ id: 'x' })

		await expect(run(makeContext({ 'idempotency-key': KEY }), next)).rejects.toBeInstanceOf(ConflictException)

		expect(next.handle).not.toHaveBeenCalled()
	})

	it('answers 409 when a concurrent duplicate wins the reservation', async () => {
		prisma.idempotencyKey.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
		const next = handler({ id: 'x' })

		await expect(run(makeContext({ 'idempotency-key': KEY }), next)).rejects.toBeInstanceOf(ConflictException)

		expect(next.handle).not.toHaveBeenCalled()
	})

	it('does not disguise a database failure as a duplicate', async () => {
		const failure = new Error('connection lost')
		prisma.idempotencyKey.create.mockRejectedValue(failure)

		await expect(run(makeContext({ 'idempotency-key': KEY }), handler({}))).rejects.toBe(failure)
	})

	it('releases the key when the handler fails so the client can retry after fixing the input', async () => {
		const failure = new Error('not enough stock')
		const next: CallHandler = { handle: () => throwError(() => failure) }

		await expect(run(makeContext({ 'idempotency-key': KEY }), next)).rejects.toBe(failure)

		expect(prisma.idempotencyKey.delete).toHaveBeenCalledWith({ where: { key: KEY } })
	})

	it('fails the request when the response cannot be saved, instead of acknowledging what it cannot replay', async () => {
		prisma.idempotencyKey.update.mockRejectedValue(new Error('db down'))

		await expect(run(makeContext({ 'idempotency-key': KEY }), handler({ id: 'd1' }))).rejects.toThrow('db down')
	})
})
