import { BaseQueryDto } from '../../common/dto/base-query.dto'

/** Лента заработка всегда идёт от новых к старым, поэтому sort/search игнорируются. */
export class QuerySellerEarningsDto extends BaseQueryDto {}
