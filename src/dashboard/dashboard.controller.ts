import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { DashboardService } from './dashboard.service'
import { DashboardResponseDto } from './dto/dashboard-response.dto'

@ApiTags('Dashboard')
@ApiBearerAuth()
@ApiErrorResponse()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOkResponse({ type: DashboardResponseDto })
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.dashboardService.getDashboard(user.marketId)
  }
}
