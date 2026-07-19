import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create(AppModule)
  const configService = app.get(ConfigService)

  const nodeEnv = configService.get('NODE_ENV', 'development')

  app.enableShutdownHooks()

  app.setGlobalPrefix('api/v1')
  app.enableCors({
    origin: nodeEnv === 'production'
      ? ['https://your-frontend-domain.com']
      : ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  const swaggerConfig = new DocumentBuilder()
    .setTitle('TradeCRM API')
    .setDescription('CRM для управления маркетами')
    .setVersion('1.0')
    .setContact('TradeCRM Team', '', 'support@tradecrm.com')
    .addServer('http://localhost:3000', 'Development')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build()

  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      showRequestDuration: true,
      syntaxHighlight: { theme: 'monokai' },
    },
    customSiteTitle: 'TradeCRM API Docs',
  })

  if (nodeEnv === 'production') {
    logger.log('Swagger docs disabled in production')
  } else {
    logger.log(`Swagger docs: http://localhost:${configService.get('PORT', 3000)}/api/docs`)
  }

  const port = configService.get('PORT', 3000)
  await app.listen(port)
  logger.log(`TradeCRM backend is running on http://localhost:${port}`)
}

bootstrap()
