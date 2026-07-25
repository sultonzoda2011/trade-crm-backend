import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { DashboardService } from './dashboard.service'
import { DashboardResponseDto } from './dto/dashboard-response.dto'
import { QueryDashboardDto } from './dto/query-dashboard.dto'

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

  @Get('sellers-report')
  @ApiOkResponse({ description: 'Sales aggregated by seller for an optional period' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  getSellersReport(@Query() query: QueryDashboardDto, @CurrentUser() user: JwtPayload) {
    return this.dashboardService.getSellersReport(query, user.marketId)
  }
}
