import type { PrismaConfig } from 'prisma'

const config: PrismaConfig = {
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
}

export default config