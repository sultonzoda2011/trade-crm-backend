import { PaginatedResult } from '../dto/pagination.dto'

interface PaginationInput {
  page?: number
  limit?: number
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
