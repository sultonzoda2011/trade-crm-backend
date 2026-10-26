import { applyDecorators, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes } from '@nestjs/swagger'
import { multerOptions } from '../utils/multipart.util'

/**
 * Combines `@ApiConsumes('multipart/form-data')` and `FileInterceptor(fieldName, multerOptions)`
 * for endpoints that accept an image upload.
 */
export function UploadImage(fieldName = 'image') {
	return applyDecorators(
		ApiConsumes('multipart/form-data'),
		UseInterceptors(FileInterceptor(fieldName, multerOptions))
	)
}
