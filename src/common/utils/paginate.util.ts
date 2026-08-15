import { PaginatedResult } from '../dto/pagination.dto'

interface PaginationInput {
  page?: number
  limit?: number
}

/**
 * Собирает orderBy. Неизвестные/неразрешённые sortBy молча заменяются на
 * defaultSortBy — в orderBy нельзя передавать произвольные ключи: это защита
 * от ошибок Prisma (P2025-класс) и от перечисления колонок через API.
 */
export function buildOrderBy(
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
  defaultSortBy = 'createdAt',
  allowedSortBy?: string[]
): Record<string, 'asc' | 'desc'> {
  const resolvedSortBy =
    sortBy && (!allowedSortBy || allowedSortBy.includes(sortBy))
      ? sortBy
      : defaultSortBy
  return { [resolvedSortBy]: sortOrder || 'desc' }
}

export function buildDateWhere(dateFrom?: string, dateTo?: string): { gte?: Date; lte?: Date } | undefined {
  if (!dateFrom && !dateTo) return undefined
  const clause: { gte?: Date; lte?: Date } = {}
  if (dateFrom) clause.gte = new Date(dateFrom)
  if (dateTo) clause.lte = new Date(dateTo)
  return clause
}

/**
 * Общий helper для пагинации, чтобы не дублировать один и тот же
 * page/limit/skip + Promise.all([findMany, count]) в каждом сервисе.
 */
export async function paginate<T>(
  { page, limit }: PaginationInput,
  fetchPage: (args: { skip: number; take: number }) => Promise<T[]>,
  fetchTotal: () => Promise<number>,
): Promise<PaginatedResult<T>> {
  const resolvedPage = page ?? 1
  // Жёсткий потолок: предотвращает ?limit=999999 и OOM-запросы
  const resolvedLimit = Math.min(limit ?? 20, 100)
  const skip = (resolvedPage - 1) * resolvedLimit

  const [data, total] = await Promise.all([
    fetchPage({ skip, take: resolvedLimit }),
    fetchTotal(),
  ])

  return {
    data,
    meta: {
      page: resolvedPage,
      limit: resolvedLimit,
      total,
      totalPages: Math.ceil(total / resolvedLimit),
    },
  }
}
