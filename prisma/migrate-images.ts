import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/client'
import { v2 as cloudinary } from 'cloudinary'
import { readFileSync, existsSync } from 'fs'
import { join, extname } from 'path'

const UPLOAD_DIR = join(process.cwd(), 'uploads')

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
})

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

interface Entity {
  id: string
  image: string | null
  label: string
}

async function migrateEntities(
  type: string,
  entities: Entity[],
  subfolder: string,
  updateFn: (id: string, url: string) => Promise<void>,
) {
  let uploaded = 0
  let skipped = 0

  for (const entity of entities) {
    if (!entity.image) {
      skipped++
      continue
    }

    const localPath = join(UPLOAD_DIR, entity.image.replace('/uploads/', ''))
    if (!existsSync(localPath)) {
      console.log(`  ⚠ ${type} ${entity.label}: файл не найден (${localPath}), пропуск`)
      skipped++
      continue
    }

    const buffer = readFileSync(localPath)
    const mimetype = MIME_MAP[extname(localPath).toLowerCase()] || 'application/octet-stream'
    const publicId = entity.image.replace('/uploads/', '').replace(/\.[^.]+$/, '')

    const result = await cloudinary.uploader.upload(
      `data:${mimetype};base64,${buffer.toString('base64')}`,
      {
        folder: `tradecrm/${subfolder}`,
        public_id: publicId.split('/').pop(),
        resource_type: 'image',
      },
    )

    await updateFn(entity.id, result.secure_url)
    console.log(`  ✓ ${type} ${entity.label}: ${entity.image} → ${result.secure_url}`)
    uploaded++
  }

  return { uploaded, skipped }
}

async function main() {
  console.log('Миграция изображений в Cloudinary...\n')

  const [users, markets, categories, products] = await Promise.all([
    prisma.user.findMany({ where: { image: { not: null } }, select: { id: true, image: true, name: true } }),
    prisma.market.findMany({ where: { image: { not: null } }, select: { id: true, image: true, name: true } }),
    prisma.category.findMany({ where: { image: { not: null } }, select: { id: true, image: true, name: true } }),
    prisma.product.findMany({ where: { image: { not: null } }, select: { id: true, image: true, name: true } }),
  ])

  console.log('Пользователи:')
  const r1 = await migrateEntities(
    'Пользователь',
    users.map(u => ({ id: u.id, image: u.image, label: u.name })),
    'users',
    (id, url) => prisma.user.update({ where: { id }, data: { image: url } }).then(() => {}),
  )

  console.log('\nРынки:')
  const r2 = await migrateEntities(
    'Рынок',
    markets.map(m => ({ id: m.id, image: m.image, label: m.name })),
    'markets',
    (id, url) => prisma.market.update({ where: { id }, data: { image: url } }).then(() => {}),
  )

  console.log('\nКатегории:')
  const r3 = await migrateEntities(
    'Категория',
    categories.map(c => ({ id: c.id, image: c.image, label: c.name })),
    'categories',
    (id, url) => prisma.category.update({ where: { id }, data: { image: url } }).then(() => {}),
  )

  console.log('\nТовары:')
  const r4 = await migrateEntities(
    'Товар',
    products.map(p => ({ id: p.id, image: p.image, label: p.name })),
    'products',
    (id, url) => prisma.product.update({ where: { id }, data: { image: url } }).then(() => {}),
  )

  const totalUploaded = r1.uploaded + r2.uploaded + r3.uploaded + r4.uploaded
  const totalSkipped = r1.skipped + r2.skipped + r3.skipped + r4.skipped

  console.log(`\n✅ Миграция завершена. Загружено: ${totalUploaded}, пропущено: ${totalSkipped}`)
}

main()
  .catch((e) => {
    console.error('❌ Ошибка:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })