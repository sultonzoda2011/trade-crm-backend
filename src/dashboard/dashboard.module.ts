import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { DashboardInsightsService } from './dashboard-insights.service'
import { DashboardMetricsService } from './dashboard-metrics.service'
import { DashboardSellersService } from './dashboard-sellers.service'
import { DashboardService } from './dashboard.service'

@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DashboardMetricsService,
    DashboardInsightsService,
    DashboardSellersService,
  ],
})
export class DashboardModule {}
