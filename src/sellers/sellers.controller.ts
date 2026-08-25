import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Query,
	UploadedFile,
	UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
	ApiBearerAuth,
	ApiBody,
	ApiConsumes,
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
import { multerOptions } from '../common/utils/multipart.util'
import { SellersService } from './sellers.service'
import { CreateSellerDto } from './dto/create-seller.dto'
import { UpdateSellerDto } from './dto/update-seller.dto'
import { QuerySellerDto } from './dto/query-seller.dto'
import { SellerResponseDto } from './dto/seller-response.dto'
import { CreateSellerCreditDto } from './dto/create-seller-credit.dto'
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
	@ApiOperation({
		summary: 'Create a seller',
		description: "Creates a new seller in the owner's market."
	})
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		schema: {
			type: 'object',
			required: ['name', 'email', 'password'],
			properties: {
				name: { type: 'string', example: 'John Doe' },
				email: { type: 'string', example: 'seller@tradecrm.com' },
				password: { type: 'string', example: 'StrongP@ss1' },
				image: { type: 'string', format: 'binary', description: 'Seller avatar (jpg, png, webp, gif; max 5MB)' },
			},
		},
	})
	@ApiCreatedResponse({ type: SellerResponseDto })
	@UseInterceptors(FileInterceptor('image', multerOptions))
	create(
		@Body() dto: CreateSellerDto,
		@UploadedFile() file?: Express.Multer.File,
		@CurrentUser('marketId') marketId?: string
	) {
		return this.sellersService.create(dto, file, marketId)
	}

	@Get()
	@ApiOperation({
		summary: 'List sellers',
		description: "Returns a paginated list of sellers in the owner's market."
	})
	@ApiOkResponse({ type: SellerResponseDto })
	@ApiQuery({
		name: 'search',
		required: false,
		description: 'Search by name or email'
	})
	@ApiQuery({ name: 'page', required: false, example: 1 })
	@ApiQuery({ name: 'limit', required: false, example: 20 })
	findAll(
		@Query() query: QuerySellerDto,
		@CurrentUser('marketId') marketId?: string
	): Promise<PaginatedResult<unknown>> {
		return this.sellersService.findAll(query, marketId)
	}

	@Get(':id')
	@ApiOperation({ summary: 'Get a seller by ID' })
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiOkResponse({ type: SellerResponseDto })
	findOne(
		@Param('id', ParseUUIDPipe) id: string,
		@CurrentUser('marketId') marketId?: string
	) {
		return this.sellersService.findOne(id, marketId)
	}

	@Patch(':id')
	@ApiOperation({ summary: 'Update a seller' })
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				name: { type: 'string', example: 'John Doe' },
				email: { type: 'string', example: 'seller@tradecrm.com' },
				password: { type: 'string', example: 'StrongP@ss1' },
				image: { type: 'string', format: 'binary', description: 'New seller avatar (replaces existing). Omit to keep current.' },
			},
		},
	})
	@ApiOkResponse({ type: SellerResponseDto })
	@UseInterceptors(FileInterceptor('image', multerOptions))
	update(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: UpdateSellerDto,
		@UploadedFile() file?: Express.Multer.File,
		@CurrentUser('marketId') marketId?: string
	) {
		return this.sellersService.update(id, dto, file, marketId)
	}

	@Delete(':id')
	@ApiOperation({ summary: 'Delete a seller' })
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiOkResponse({ description: 'Seller successfully deleted' })
	remove(
		@Param('id', ParseUUIDPipe) id: string,
		@CurrentUser('marketId') marketId?: string
	) {
		return this.sellersService.remove(id, marketId)
	}

	@Get(':id/balance')
	@ApiOperation({
		summary: "Get a seller's markup balance",
		description:
			'Returns how much markup the seller has earned, how much was reversed by refunds, how much was already paid out, and the current balance available to pay out.'
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiOkResponse({ type: SellerBalanceResponseDto })
	getBalance(
		@Param('id', ParseUUIDPipe) id: string,
		@CurrentUser('marketId') marketId?: string
	) {
		return this.sellersService.getBalance(id, marketId)
	}

	@Post(':id/credits')
	@ApiOperation({
		summary: 'Pay out part or all of the seller\'s markup balance',
		description:
			"Records a payout to the seller. Amount cannot exceed the seller's current balance. Payouts can be made in parts."
	})
	@ApiParam({ name: 'id', type: String, format: 'uuid' })
	@ApiCreatedResponse({ type: SellerCreditResponseDto })
	createCredit(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: CreateSellerCreditDto,
		@CurrentUser() user: JwtPayload,
		@CurrentUser('marketId') marketId?: string
	) {
		return this.sellersService.createCredit(id, dto, user, marketId)
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
		@CurrentUser('marketId') marketId?: string
	): Promise<PaginatedResult<unknown>> {
		return this.sellersService.listCredits(id, query, marketId)
	}
}
