import { applyDecorators, HttpStatus } from '@nestjs/common'
import { ApiResponse } from '@nestjs/swagger'

export function ApiErrorResponse() {
  return applyDecorators(
    ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation failed — invalid input data' }),
    ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' }),
    ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Insufficient role permissions' }),
    ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Resource not found' }),
    ApiResponse({ status: HttpStatus.CONFLICT, description: 'Resource already exists (e.g. duplicate email)' }),
    ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error' }),
  )
}
