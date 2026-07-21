import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Query
} from '@nestjs/common'
import {
	ApiBearerAuth,
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
import { SellersService } from './sellers.service'
import { CreateSellerDto } from './dto/create-seller.dto'
import { UpdateSellerDto } from './dto/update-seller.dto'
import { QuerySellerDto } from './dto/query-seller.dto'
import { SellerResponseDto } from './dto/seller-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'

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
	@ApiCreatedResponse({ type: SellerResponseDto })
	create(
		@Body() dto: CreateSellerDto,
		@CurrentUser('marketId') marketId?: string
	) {
		return this.sellersService.create(dto, marketId)
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
	@ApiOkResponse({ type: SellerResponseDto })
	update(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: UpdateSellerDto,
		@CurrentUser('marketId') marketId?: string
	) {
		return this.sellersService.update(id, dto, marketId)
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
}
