import { Test } from '@nestjs/testing'
import { ServiceUnavailableException } from '@nestjs/common'
import { HealthController } from './health.controller'
import { PrismaService } from '../prisma/prisma.service'

describe('HealthController', () => {
	let controller: HealthController
	let prisma: { $queryRaw: jest.Mock }

	beforeEach(async () => {
		prisma = { $queryRaw: jest.fn() }

		const moduleRef = await Test.createTestingModule({
			controllers: [HealthController],
			providers: [{ provide: PrismaService, useValue: prisma }]
		}).compile()

		controller = moduleRef.get(HealthController)
	})

	it('returns ok when DB is reachable', async () => {
		prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

		const result = await controller.check()

		expect(result.status).toBe('ok')
		expect(result.database).toBe('up')
		expect(result.timestamp).toBeDefined()
	})

	it('throws ServiceUnavailable when DB is down', async () => {
		prisma.$queryRaw.mockRejectedValue(new Error('connection refused'))

		await expect(controller.check()).rejects.toThrow(
			ServiceUnavailableException
		)
	})
})