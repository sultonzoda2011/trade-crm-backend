import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Role } from '../enums'
import { Roles } from '../auth/decorators/roles.decorator'
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe'
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator'
import { multerOptions } from '../common/utils/multipart.util'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { QueryUserDto } from './dto/query-user.dto'
import { UserResponseDto } from './dto/user-response.dto'
import { PaginatedResult } from '../common/dto/pagination.dto'
import { Express } from 'express'

@ApiTags('Users')
@ApiBearerAuth()
@ApiErrorResponse()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'email', 'password', 'role'],
      properties: {
        name: { type: 'string', example: 'John Doe' },
        email: { type: 'string', example: 'john@tradecrm.com' },
        password: { type: 'string', example: 'StrongP@ss1' },
        role: { type: 'string', enum: ['ADMIN', 'OWNER', 'SELLER'], example: 'SELLER' },
        image: { type: 'string', format: 'binary', description: 'User avatar (jpg, png, webp, gif; max 5MB)' },
      },
    },
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @UseInterceptors(FileInterceptor('image', multerOptions))
  create(@Body() dto: CreateUserDto, @UploadedFile() file?: Express.Multer.File) {
    return this.usersService.create(dto, file)
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: UserResponseDto })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or email' })
  @ApiQuery({ name: 'role', required: false, enum: ['ADMIN', 'OWNER', 'SELLER'] })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  findAll(@Query() query: QueryUserDto): Promise<PaginatedResult<unknown>> {
    return this.usersService.findAll(query)
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: UserResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id)
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'John Doe' },
        email: { type: 'string', example: 'john@tradecrm.com' },
        password: { type: 'string', example: 'StrongP@ss1' },
        role: { type: 'string', enum: ['ADMIN', 'OWNER', 'SELLER'], example: 'SELLER' },
        image: { type: 'string', format: 'binary', description: 'New user avatar (replaces existing). Omit to keep current.' },
      },
    },
  })
  @ApiOkResponse({ type: UserResponseDto })
  @UseInterceptors(FileInterceptor('image', multerOptions))
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @UploadedFile() file?: Express.Multer.File) {
    return this.usersService.update(id, dto, file)
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ description: 'User deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id)
  }
}
