import { PaginatedResult } from '../dto/pagination.dto'

interface PaginationInput {
  page?: number
  limit?: number
}

export function buildOrderBy(sortBy?: string, sortOrder?: 'asc' | 'desc', defaultSortBy = 'createdAt'): Record<string, 'asc' | 'desc'> {
  return { [sortBy || defaultSortBy]: sortOrder || 'desc' }
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
  const resolvedLimit = limit ?? 20
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
