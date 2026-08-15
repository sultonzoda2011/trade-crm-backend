import { AnalyticsPeriod, PeriodQueryDto } from '../dto/period-query.dto'

export interface DateRange {
  gte: Date
  lte: Date
}

export interface ResolvedPeriod {
  /** Текущее окно, по которому считаются все метрики. */
  current: DateRange
  /**
   * Сопоставимое предыдущее окно той же длины. Используется только для
   * сравнения «период к периоду» — никогда для основных цифр.
   */
  previous: DateRange
  /** Гранулярность для date_trunc в трендах. */
  truncUnit: 'day' | 'month'
  /** Длина окна в днях — база для «средних продаж в день». */
  durationDays: number
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Окно «долг скоро просрочится», дни.
 *
 * Живёт здесь, а не в дашборде: рекомендация «N долгов подходят к сроку»
 * ведёт на отфильтрованный список транзакций, и если бы окна расходились,
 * пользователь увидел бы там другое число.
 */
export const DUE_SOON_DAYS = 3

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  )
}

function shiftDays(date: Date, delta: number): Date {
  return new Date(date.getTime() + delta * MS_PER_DAY)
}

/**
 * Сдвиг на календарные месяцы с зажимом дня месяца: 31 марта − 1 месяц
 * должно давать 28/29 февраля, а не 2/3 марта, как получилось бы при
 * естественном переполнении Date.UTC.
 */
function shiftMonths(date: Date, delta: number): Date {
  const targetMonth = date.getUTCMonth() + delta
  const daysInTarget = new Date(
    Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0),
  ).getUTCDate()

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      targetMonth,
      Math.min(date.getUTCDate(), daysInTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  )
}

function buildCurrentRange(period: AnalyticsPeriod, now: Date): DateRange {
  const lte = endOfUtcDay(now)

  switch (period) {
    case AnalyticsPeriod.TODAY:
      return {
        gte: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        ),
        lte,
      }
    case AnalyticsPeriod.WEEK:
      return {
        gte: new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            // Неделя с понедельника: getUTCDay() воскресенье = 0.
            now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
          ),
        ),
        lte,
      }
    case AnalyticsPeriod.MONTH:
      return {
        gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        lte,
      }
    case AnalyticsPeriod.YEAR:
      return {
        gte: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
        lte,
      }
  }
}

/**
 * Предыдущее окно строится сдвигом текущего НАЗАД на длину периода, а не как
 * «весь прошлый месяц». Это принципиально: 10 дней текущего месяца нельзя
 * честно сравнивать с 31 днём прошлого — сравнение показывало бы падение
 * там, где его нет. Сдвиг сохраняет и длину окна, и его «незавершённость».
 */
function buildPreviousRange(
  period: AnalyticsPeriod | undefined,
  current: DateRange,
): DateRange {
  switch (period) {
    case AnalyticsPeriod.TODAY:
      return { gte: shiftDays(current.gte, -1), lte: shiftDays(current.lte, -1) }
    case AnalyticsPeriod.WEEK:
      return { gte: shiftDays(current.gte, -7), lte: shiftDays(current.lte, -7) }
    case AnalyticsPeriod.MONTH:
      return { gte: shiftMonths(current.gte, -1), lte: shiftMonths(current.lte, -1) }
    case AnalyticsPeriod.YEAR:
      return { gte: shiftMonths(current.gte, -12), lte: shiftMonths(current.lte, -12) }
    default: {
      // Произвольный диапазон: берём окно такой же длины, вплотную перед ним.
      const durationMs = current.lte.getTime() - current.gte.getTime()
      return {
        gte: new Date(current.gte.getTime() - durationMs - 1),
        lte: new Date(current.gte.getTime() - 1),
      }
    }
  }
}

/**
 * Единая точка разбора периода для всей аналитики.
 *
 * Все границы считаются в UTC — чтобы фильтр, бакеты date_trunc (сессия БД
 * в UTC) и подписи дней не расходились на хостах с ненулевым TZ-смещением.
 * Без period/dateFrom/dateTo по умолчанию берётся текущий месяц.
 */
export function resolvePeriod(
  query: PeriodQueryDto,
  now: Date = new Date(),
): ResolvedPeriod {
  let current: DateRange

  if (query.period) {
    current = buildCurrentRange(query.period, now)
  } else if (query.dateFrom || query.dateTo) {
    current = {
      gte: query.dateFrom ? new Date(query.dateFrom) : new Date(0),
      // Голый dateTo=YYYY-MM-DD парсится в полночь и отрезал бы весь
      // последний день — дотягиваем до конца суток.
      lte: query.dateTo ? endOfUtcDay(new Date(query.dateTo)) : endOfUtcDay(now),
    }
  } else {
    current = buildCurrentRange(AnalyticsPeriod.MONTH, now)
  }

  const durationMs = Math.max(current.lte.getTime() - current.gte.getTime(), 0)

  return {
    current,
    previous: buildPreviousRange(query.period, current),
    truncUnit: query.period === AnalyticsPeriod.YEAR ? 'month' : 'day',
    // Минимум 1 день, иначе «средние продажи в день» делятся на ноль.
    durationDays: Math.max(Math.round(durationMs / MS_PER_DAY), 1),
  }
}

export interface MetricComparison {
  current: number
  previous: number
  difference: number
  /**
   * null, когда предыдущее значение = 0: рост «с нуля» не выражается
   * в процентах, и рисовать +100% или +∞ было бы враньём.
   */
  changePercent: number | null
}

export function buildComparison(
  current: number,
  previous: number,
): MetricComparison {
  const difference = round2(current - previous)
  return {
    current: round2(current),
    previous: round2(previous),
    difference,
    changePercent:
      previous === 0 ? null : Math.round((difference / Math.abs(previous)) * 1000) / 10,
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Бакеты date_trunc считаются в UTC-сессии БД — форматируем тоже в UTC,
 * чтобы подписи дней не сдвигались на хостах с ненулевым смещением TZ.
 */
export function formatSqlDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toISOString().slice(0, 10)
}
