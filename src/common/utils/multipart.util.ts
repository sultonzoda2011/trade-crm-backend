import { BadRequestException } from '@nestjs/common'
import { memoryStorage } from 'multer'
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface'

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

const MAX_FILE_SIZE = 5 * 1024 * 1024

export function imageFileFilter(_req: any, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    callback(new BadRequestException(`Invalid file type: ${file.mimetype}. Allowed: jpg, png, webp, gif`), false)
    return
  }
  callback(null, true)
}

export const multerOptions: MulterOptions = {
  storage: memoryStorage(),
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
}
