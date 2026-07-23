import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class StatsDto {
  @ApiProperty()
  totalMarkets: number

  @ApiProperty()
  totalUsers: number

  @ApiProperty()
  totalDebtors: number

  @ApiProperty()
  totalTransactions: number

  @ApiProperty()
  activeDebts: number

  @ApiProperty()
  partialDebts: number

  @ApiProperty()
  totalDebtAmount: number

  @ApiProperty()
  totalSaleAmount: number

  @ApiProperty()
  todayTransactions: number
}

class DashboardDebtorDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string
}

class DashboardMarketDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string
}

class DashboardUserDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string
}

export class RecentTransactionDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  type: string

  @ApiProperty()
  paymentType: string

  @ApiProperty()
  totalAmount: number

  @ApiProperty()
  remainingAmount: number

  @ApiProperty()
  status: string

  @ApiProperty()
  createdAt: string

  @ApiPropertyOptional({ type: DashboardDebtorDto })
  debtor?: DashboardDebtorDto

  @ApiPropertyOptional({ type: DashboardMarketDto })
  market?: DashboardMarketDto

  @ApiPropertyOptional({ type: DashboardUserDto })
  createdBy?: DashboardUserDto
}

class TopDebtorMarketDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string
}

export class TopDebtorDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  phone: string

  @ApiPropertyOptional({ type: TopDebtorMarketDto })
  market?: TopDebtorMarketDto

  @ApiProperty()
  totalDebt: number

  @ApiProperty()
  activeTransactions: number
}

export class DashboardResponseDto {
  @ApiProperty({ type: StatsDto })
  stats: StatsDto

  @ApiProperty({ type: [RecentTransactionDto] })
  recentTransactions: RecentTransactionDto[]

  @ApiProperty({ type: [TopDebtorDto] })
  topDebtors: TopDebtorDto[]
}
