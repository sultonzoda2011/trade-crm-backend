import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { v2 as cloudinary } from 'cloudinary'
import { Express } from 'express'
import { ALLOWED_IMAGE_MIME_TYPES } from '../utils/multipart.util'

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

function extractPublicId(secureUrl: string): string {
  const url = new URL(secureUrl)
  const parts = url.pathname.split('/')
  const uploadIndex = parts.indexOf('upload')
  if (uploadIndex === -1) {
    throw new Error('Invalid Cloudinary URL')
  }
  // Фильтруем только сегмент с версией вида "v123456", а не любой путь,
  // начинающийся с "v" (например, папка "videos" или "v2-products").
  const rest = parts.slice(uploadIndex + 1).filter(p => !/^v\d+$/.test(p)).join('/')
  return rest.replace(/\.[^.]+$/, '')
}

@Injectable()
export class StorageService {
  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get('CLOUDINARY_API_SECRET'),
    })
  }

  async save(file: Express.Multer.File, subfolder: string): Promise<string> {
    const ext = ALLOWED_IMAGE_MIME_TYPES[file.mimetype]
    if (!ext || !matchesSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException('File content does not match a supported image type')
    }

    const result = await cloudinary.uploader.upload(
      `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      {
        folder: `tradecrm/${subfolder}`,
        public_id: randomUUID(),
        resource_type: 'image',
      },
    )

    return result.secure_url
  }

  async delete(fileUrl: string): Promise<void> {
    if (!fileUrl) return
    const publicId = extractPublicId(fileUrl)
    await cloudinary.uploader.destroy(publicId)
  }
}