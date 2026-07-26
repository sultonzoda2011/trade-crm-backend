import type { PrismaConfig } from 'prisma'

const config: PrismaConfig = {
  earlyAccess: true,
  schema: {
    path: 'prisma/schema.prisma',
  },
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
}

export default config