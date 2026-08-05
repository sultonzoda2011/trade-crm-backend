import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { Public } from '../auth/decorators/public.decorator'
import { PrismaService } from '../prisma/prisma.service'

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' })
    }

    return { status: 'ok', database: 'up', timestamp: new Date().toISOString() }
  }
}
