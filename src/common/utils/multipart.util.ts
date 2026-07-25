import { BadRequestException } from '@nestjs/common'
import { memoryStorage } from 'multer'
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface'

// Единственный источник правды для допустимых типов изображений: и для
// проверки mimetype, и для выбора расширения при сохранении файла — чтобы
// имя файла, присланное клиентом, никогда не влияло на расширение,
// с которым файл реально сохраняется на диск.
export const ALLOWED_IMAGE_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

const MAX_FILE_SIZE = 5 * 1024 * 1024

export function imageFileFilter(_req: any, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) {
  if (!ALLOWED_IMAGE_MIME_TYPES[file.mimetype]) {
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
