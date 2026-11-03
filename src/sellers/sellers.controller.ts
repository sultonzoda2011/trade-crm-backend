import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	Param,
	Patch,
	Post,
	Query,
	UploadedFile
} from '@nestjs/common'
import {
	ApiBearerAuth,
	ApiBody,
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiTags
} from '@nestjs/swagger'
import { Role } from '../enums'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { JwtPayload } from '../interfaces'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { UploadImage } from '../common/decorators/upload-image.decorator'
import { marketScope } from '../markets/market-scope.util'
import { SellersService } from './sellers.service'
import { CreateSellerDto } from './dto/create-seller.dto'
import { UpdateSellerDto } from './dto/update-seller.dto'
import { QuerySellerDto } from './dto/query-seller.dto'
import { QuerySellerSummaryDto } from './dto/query-seller-summary.dto'
import { QuerySellerEarningsDto } from './dto/query-seller-earnings.dto'
import { SellerResponseDto } from './dto/seller-response.dto'
import { CreateSellerCreditDto } from './dto/create-seller-credit.dto'
import { ReverseSellerCreditDto } from './dto/reverse-seller-credit.dto'
import { QuerySellerCreditDto } from './dto/query-seller-credit.dto'
import { SellerBalanceResponseDto } from './dto/seller-balance-response.dto'
import { SellerCreditResponseDto } from './dto/seller-credit-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { Express } from 'express'

@ApiTags('Sellers')
@ApiBearerAuth()
@ApiErrorResponse()
@Roles(Role.OWNER, Role.ADMIN)
@Controller('sellers')
export class SellersController {
	constructor(private readonly sellersService: SellersService) {}

	@Post()
	@UploadImage()
	@ApiOperation({
		summary: 'Create a seller',
		description:
			"Creates a new seller in the owner's market. ADMIN has no market of their own and must pass `marketId`."
	})
	@ApiBody({
		schema: {
			type: 'object',
			required: ['name', 'email', 'password'],
			properties: {
				name: { type: 'string', example: 'John Doe' },
				email: { type: 'string', example: 'seller@tradecrm.com' },
				password: { type: 'string', example: 'StrongP@ss1' },
				phone: { type: 'string', example: '+992 900 12-34-56' },
				marketId: { type: 'string', format: 'uuid', description: 'Required for ADMIN, ignored for OWNER' },
				image: { type: 'string', format: 'binary', description: 'Seller avatar (jpg, png, webp, gif; max 5MB)' }
			}
		}
	})
	@ApiCreatedResponse({ type: SellerResponseDto })
	create(
		@Body() dto: CreateSellerDto,
		@CurrentUser() user: JwtPayload,
		@UploadedFile() file?: Express.Multer.File
	) {
		return this.sellersService.create(dto, file, user)
	}

	@Get()
	@ApiOperation({
		summary: 'List sellers',
		description:
			"Paginated sellers of the owner's market. With `withStats=true` (or sorting by sold/earned/balance/lastSaleAt) every row carries `stats`: sold and earned for the period plus the all-time balance owed."
	})
	@ApiOkResponse({ type: SellerResponseDto })
	@ApiQuery({ name: 'search', required: false, description: 'Search by name, email or phone' })
	@ApiQuery({ name: 'page', required: false, example: 1 })
	@ApiQuery({ name: 'limit', required: false, example: 20 })
	findAll(
		@Query() query: QuerySellerDto,
		@CurrentUser() user: JwtPayload
	): Promise<PaginatedResult<unknown>> {
		return this.sellersService.findAll(query, marketScope(user))
	}

	// Статические пути (summary) стоят раньше :id.
	@Get('summary')
	@ApiOperation({
		summary: 'Sellers screen header',
		description:
			'Sold and earned for the period, total owed to sellers right now (positive balances only), overpayments and how many sellers are active/disabled.'
	})
	summary(@Query() query: QuerySellerSummaryDto, @CurrentUser() user: JwtPayload) {
		return this.sellersService.summary(query, marketScope(user))
	}

	@Get(':id')
	@ApiOperation({ summary: 'Get a seller by ID' })
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiOkResponse({ type: SellerResponseDto })
	findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
		return this.sellersService.findOne(id, marketScope(user))
	}

	@Get(':id/full')
	@ApiOperation({
		summary: 'Seller detail page in one round-trip',
		description:
			'Seller (+ `hasHistory`) + recent receipts + balance + this month totals + recent payouts + first page of the earnings feed.'
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	findOneFull(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
		return this.sellersService.findOneFull(id, marketScope(user))
	}

	@Patch(':id')
	@UploadImage()
	@ApiOperation({ summary: 'Update a seller' })
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				name: { type: 'string', example: 'John Doe' },
				email: { type: 'string', example: 'seller@tradecrm.com' },
				password: { type: 'string', example: 'StrongP@ss1' },
				phone: { type: 'string', example: '+992 900 12-34-56', description: 'Empty string clears the phone' },
				image: {
					type: 'string',
					format: 'binary',
					description: 'New seller avatar (replaces existing). Omit to keep current.'
				}
			}
		}
	})
	@ApiOkResponse({ type: SellerResponseDto })
	update(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: UpdateSellerDto,
		@CurrentUser() user: JwtPayload,
		@UploadedFile() file?: Express.Multer.File
	) {
		return this.sellersService.update(id, dto, file, marketScope(user))
	}

	@Delete(':id')
	@ApiOperation({
		summary: 'Delete a seller',
		description:
			'Only a seller without receipts, payments or payouts can be deleted (409 SELLER_HAS_HISTORY otherwise) — disable the account instead.'
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiOkResponse({ description: 'Seller successfully deleted' })
	remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
		return this.sellersService.remove(id, marketScope(user))
	}

	@Post(':id/deactivate')
	@HttpCode(200)
	@ApiOperation({
		summary: 'Disable a seller',
		description: 'The seller can no longer log in (a live session ends within a minute). Receipts, payments and payouts stay.'
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiOkResponse({ type: SellerResponseDto })
	deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
		return this.sellersService.deactivate(id, marketScope(user), user.id)
	}

	@Post(':id/activate')
	@HttpCode(200)
	@ApiOperation({ summary: 'Enable a disabled seller again' })
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiOkResponse({ type: SellerResponseDto })
	activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
		return this.sellersService.activate(id, marketScope(user))
	}

	@Post(':id/reset-password')
	@HttpCode(200)
	// Ответ содержит пароль в открытом виде — его нельзя кешировать нигде по пути.
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: "Reset a seller's password",
		description:
			'Generates a new password and returns it ONCE (`{ password }`). Pass it to the seller; they change it in their profile. Sessions issued earlier stay valid until their token expires.'
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	resetPassword(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
		return this.sellersService.resetPassword(id, marketScope(user))
	}

	@Get(':id/balance')
	@ApiOperation({
		summary: "Get a seller's markup balance",
		description:
			'How much markup the seller has earned, how much was reversed by refunds, how much was already paid out (cancelled payouts subtracted), and the current balance owed.'
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiOkResponse({ type: SellerBalanceResponseDto })
	getBalance(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
		return this.sellersService.getBalance(id, marketScope(user))
	}

	@Get(':id/earnings')
	@ApiOperation({
		summary: 'What the seller balance is made of',
		description:
			'Newest-first feed: markup earned per receipt, markup reversed by refunds, payouts and their cancellations. `amount` is the signed effect on the balance, so the sum of every entry equals `balance`.'
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiQuery({ name: 'page', required: false, example: 1 })
	@ApiQuery({ name: 'limit', required: false, example: 20 })
	getEarnings(
		@Param('id', ParseUUIDPipe) id: string,
		@Query() query: QuerySellerEarningsDto,
		@CurrentUser() user: JwtPayload
	) {
		return this.sellersService.getEarnings(id, query, marketScope(user))
	}

	@Post(':id/credits')
	@ApiOperation({
		summary: "Pay out part or all of the seller's markup balance",
		description:
			"Records a payout to the seller. Amount cannot exceed the seller's current balance (checked under a row lock, so parallel payouts cannot overpay). Payouts can be made in parts."
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiCreatedResponse({ type: SellerCreditResponseDto })
	createCredit(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: CreateSellerCreditDto,
		@CurrentUser() user: JwtPayload
	) {
		return this.sellersService.createCredit(id, dto, user, marketScope(user))
	}

	@Post(':id/credits/:creditId/reverse')
	@ApiOperation({
		summary: 'Cancel a payout',
		description:
			'Adds an offsetting entry with a negative amount; the original payout stays in the history. A payout can be cancelled once.'
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiParam({ name: 'creditId', type: String, format: 'uuid' })
	@ApiCreatedResponse({ type: SellerCreditResponseDto })
	reverseCredit(
		@Param('id', ParseUUIDPipe) id: string,
		@Param('creditId', ParseUUIDPipe) creditId: string,
		@Body() dto: ReverseSellerCreditDto,
		@CurrentUser() user: JwtPayload
	) {
		return this.sellersService.reverseCredit(id, creditId, dto, user, marketScope(user))
	}

	@Get(':id/credits')
	@ApiOperation({ summary: "Get a seller's payout history" })
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiOkResponse({ type: SellerCreditResponseDto })
	@ApiQuery({ name: 'page', required: false, example: 1 })
	@ApiQuery({ name: 'limit', required: false, example: 20 })
	listCredits(
		@Param('id', ParseUUIDPipe) id: string,
		@Query() query: QuerySellerCreditDto,
		@CurrentUser() user: JwtPayload
	): Promise<PaginatedResult<unknown>> {
		return this.sellersService.listCredits(id, query, marketScope(user))
	}
}
