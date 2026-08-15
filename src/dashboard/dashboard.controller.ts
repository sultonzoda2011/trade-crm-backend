import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { Role } from '../enums'
import { JwtPayload } from '../interfaces'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { DashboardService } from './dashboard.service'
import { DashboardResponseDto } from './dto/dashboard-response.dto'
import { DashboardPeriod, QueryDashboardDto } from './dto/query-dashboard.dto'

@ApiTags('Dashboard')
@ApiBearerAuth()
@ApiErrorResponse()
@Roles(Role.ADMIN, Role.OWNER)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOkResponse({ type: DashboardResponseDto })
  getDashboard(@Query() query: QueryDashboardDto, @CurrentUser() user: JwtPayload) {
    return this.dashboardService.getDashboard(query, user.marketId)
  }

  // Одна точка входа для главного экрана: продажи, долги, возвраты, склад,
  // сравнение с предыдущим окном и готовые рекомендации. Один запрос вместо
  // пяти — экран открывается за один round-trip.
  @Get('overview')
  @ApiOperation({
    summary: 'Business control center',
    description:
      'Single-request dashboard payload: sales, debts, returns, inventory health, reorder list, category and revenue trends, period-over-period comparison and deterministic business insights.',
  })
  @ApiOkResponse({ description: 'Aggregated business overview for the selected period' })
  @ApiQuery({ name: 'period', required: false, enum: DashboardPeriod, description: 'Predefined period. Default: month' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Custom period start (used when period is omitted)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'Custom period end (used when period is omitted)' })
  @ApiQuery({ name: 'sellerId', required: false, description: 'Narrow every figure to one seller' })
  getOverview(@Query() query: QueryDashboardDto, @CurrentUser() user: JwtPayload) {
    return this.dashboardService.getOverview(query, user.marketId)
  }

  @Get('sellers-report')
  @ApiOperation({
    summary: 'Sellers performance report',
    description:
      'Net sales per seller (gross minus refunds), refunds, debts issued, debt collection, return rate and comparison with the previous period of the same length.',
  })
  @ApiOkResponse({ description: 'Sales aggregated by seller for an optional period' })
  @ApiQuery({ name: 'period', required: false, enum: DashboardPeriod })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'sellerId', required: false })
  getSellersReport(@Query() query: QueryDashboardDto, @CurrentUser() user: JwtPayload) {
    return this.dashboardService.getSellersReport(query, user.marketId)
  }
}
