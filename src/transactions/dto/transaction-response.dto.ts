import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaymentResponseDto } from './payment-response.dto'

class TransactionItemProductDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  price: number
}

class TransactionItemDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  productId: string

  @ApiProperty()
  productName: string

  @ApiProperty()
  quantity: number

  @ApiProperty()
  price: number

  @ApiProperty()
  totalPrice: number

  @ApiPropertyOptional({ type: TransactionItemProductDto })
  product?: TransactionItemProductDto
}

class TransactionUserDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  email: string
}

class TransactionDebtorDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  phone: string
}

class TransactionMarketDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  address: string
}

export class TransactionResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  marketId: string

  @ApiProperty()
  createdById: string

  @ApiPropertyOptional()
  debtorId?: string

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

  @ApiProperty()
  updatedAt: string

  @ApiPropertyOptional({ type: [TransactionItemDto] })
  items?: TransactionItemDto[]

  @ApiPropertyOptional({ type: TransactionUserDto })
  createdBy?: TransactionUserDto

  @ApiPropertyOptional({ type: TransactionDebtorDto })
  debtor?: TransactionDebtorDto

  @ApiPropertyOptional({ type: TransactionMarketDto })
  market?: TransactionMarketDto

  @ApiPropertyOptional({ type: [PaymentResponseDto] })
  payments?: PaymentResponseDto[]
}
