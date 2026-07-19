import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { Express } from 'express'

const UPLOAD_DIR = join(process.cwd(), 'uploads')

@Injectable()
export class StorageService {
  save(file: Express.Multer.File, subfolder: string): string {
    const dest = join(UPLOAD_DIR, subfolder)
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true })
    }

    const ext = extname(file.originalname)
    const filename = `${randomUUID()}${ext}`
    const filePath = join(dest, filename)

    writeFileSync(filePath, file.buffer)

    return `/uploads/${subfolder}/${filename}`
  }

  delete(fileUrl: string): void {
    const filename = fileUrl.replace('/uploads/', '')
    const filePath = join(UPLOAD_DIR, filename)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }
}
