import { BadRequestException, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { promises as fs, existsSync } from 'fs'
import { join } from 'path'
import { Express } from 'express'
import { ALLOWED_IMAGE_MIME_TYPES } from '../utils/multipart.util'

const UPLOAD_DIR = join(process.cwd(), 'uploads')

// Проверка магических байт файла — mimetype в заголовке запроса полностью
// контролируется клиентом и может быть подделан, поэтому расширению/типу
// файла нельзя доверять без проверки реального содержимого.
function matchesSignature(buffer: Buffer, mimetype: string): boolean {
  const sig = buffer.subarray(0, 12)
  switch (mimetype) {
    case 'image/jpeg':
      return sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff
    case 'image/png':
      return sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47
    case 'image/gif':
      return sig.subarray(0, 3).toString('ascii') === 'GIF'
    case 'image/webp':
      return sig.subarray(0, 4).toString('ascii') === 'RIFF' && sig.subarray(8, 12).toString('ascii') === 'WEBP'
    default:
      return false
  }
}

@Injectable()
export class StorageService {
  async save(file: Express.Multer.File, subfolder: string): Promise<string> {
    const ext = ALLOWED_IMAGE_MIME_TYPES[file.mimetype]
    if (!ext || !matchesSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException('File content does not match a supported image type')
    }

    const dest = join(UPLOAD_DIR, subfolder)
    if (!existsSync(dest)) {
      await fs.mkdir(dest, { recursive: true })
    }

    // Расширение выбирается из проверенного mimetype, а не из имени файла,
    // присланного клиентом — исключает сохранение файла с произвольным
    // (например, исполняемым) расширением под маской "картинки".
    const filename = `${randomUUID()}${ext}`
    const filePath = join(dest, filename)

    await fs.writeFile(filePath, file.buffer)

    return `/uploads/${subfolder}/${filename}`
  }

  async delete(fileUrl: string): Promise<void> {
    const filename = fileUrl.replace('/uploads/', '')
    const filePath = join(UPLOAD_DIR, filename)
    if (existsSync(filePath)) {
      await fs.unlink(filePath)
    }
  }
}
