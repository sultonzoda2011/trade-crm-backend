import { Global, Module } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'

/**
 * Аналитика — общий слой бизнес-расчётов (скорость продаж, запас в днях,
 * приоритет закупки, здоровье товара). Глобальный, потому что этими
 * же метриками пользуются и products, и dashboard: считать их в двух
 * местах по-разному — прямой путь к расхождению цифр в интерфейсе.
 */
@Global()
@Module({
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
