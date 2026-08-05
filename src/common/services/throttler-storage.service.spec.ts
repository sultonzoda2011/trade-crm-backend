import { PrismaThrottlerStorage } from './throttler-storage.service'

describe('PrismaThrottlerStorage', () => {
	let prisma: any
	let storage: PrismaThrottlerStorage

	beforeEach(() => {
		prisma = { $queryRaw: jest.fn() }
		storage = new PrismaThrottlerStorage(prisma)
	})

	const row = (hits: number, blockedUntil: Date | null) => ({
		hits,
		expiresAt: new Date(Date.now() + 60_000),
		blockedUntil
	})

	it('returns hits=1 for a fresh key and is not blocked', async () => {
		prisma.$queryRaw.mockResolvedValue([row(1, null)])

		const record = await storage.increment('k', 60_000, 100, 60_000, 'default')

		expect(record.totalHits).toBe(1)
		expect(record.isBlocked).toBe(false)
		expect(record.timeToExpire).toBeGreaterThan(0)
	})

	it('reports a blocked bucket with timeToBlockExpire', async () => {
		prisma.$queryRaw.mockResolvedValue([
			row(101, new Date(Date.now() + 30_000))
		])

		const record = await storage.increment('k', 60_000, 100, 60_000, 'default')

		expect(record.isBlocked).toBe(true)
		expect(record.timeToBlockExpire).toBeGreaterThan(0)
	})

	it('keeps hits unchanged while blocked', async () => {
		prisma.$queryRaw.mockResolvedValue([
			row(101, new Date(Date.now() + 30_000))
		])

		const first = await storage.increment('k', 60_000, 100, 60_000, 'default')
		const second = await storage.increment('k', 60_000, 100, 60_000, 'default')

		expect(first.totalHits).toBe(101)
		expect(second.totalHits).toBe(101)
	})

	it('reports an expired block as not blocked', async () => {
		prisma.$queryRaw.mockResolvedValue([
			row(101, new Date(Date.now() - 1000))
		])

		const record = await storage.increment('k', 60_000, 100, 60_000, 'default')

		expect(record.isBlocked).toBe(false)
	})

	it('composites the key with the throttler name and passes limit/block duration', async () => {
		prisma.$queryRaw.mockResolvedValue([row(1, null)])

		await storage.increment('ctx-key', 60_000, 5, 60_000, 'login')

		const callArgs = prisma.$queryRaw.mock.calls[0]
		expect(callArgs[1]).toBe('login:ctx-key')
		expect(callArgs).toContain(5)
	})
})
