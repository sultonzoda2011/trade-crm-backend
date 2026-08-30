import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { SyncService } from './sync.service'

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
	constructor(private readonly syncService: SyncService) {}

	/**
	 * Инкрементальный пул для офлайн-клиента (Capacitor APK).
	 * `since` — ISO-таймстамп последней успешной синхронизации; без него
	 * отдаётся полный снапшот маркета пользователя.
	 */
	@Get('pull')
	@ApiOperation({
		summary: 'Get everything changed in the user market since a timestamp'
	})
	@ApiQuery({ name: 'since', required: false, type: String })
	@ApiOkResponse({ description: 'Delta snapshot for the offline client' })
	pull(@CurrentUser() user: JwtPayload, @Query('since') since?: string) {
		return this.syncService.pull(user, since)
	}
}
