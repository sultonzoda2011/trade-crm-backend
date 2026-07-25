import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Response } from 'express'

function normalizeMessage(message: unknown): string[] {
  if (Array.isArray(message)) {
    return message.flatMap(normalizeMessage)
  }
  if (typeof message === 'string') {
    return message
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  }
  if (typeof message === 'object' && message !== null) {
    return [JSON.stringify(message)]
  }
  return [String(message)]
}

const isProduction = process.env.NODE_ENV === 'production'

// Известные коды ошибок Prisma, которые можно безопасно превратить в понятный 4xx
// без утечки деталей схемы/БД клиенту.
const PRISMA_FK_RESTRICT_CODE = 'P2003'
const PRISMA_UNIQUE_CONSTRAINT_CODE = 'P2002'
const PRISMA_NOT_FOUND_CODE = 'P2025'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter')

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let messages: string[] = ['Internal server error']
    let error: string | undefined

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const res = exception.getResponse()

      if (typeof res === 'string') {
        messages = [res]
      } else if (typeof res === 'object') {
        const body = res as Record<string, any>
        messages = normalizeMessage(body.message ?? exception.message)
        error = body.error
      }
    } else if (this.isPrismaError(exception, PRISMA_FK_RESTRICT_CODE)) {
      status = HttpStatus.CONFLICT
      messages = ['Cannot complete this action: the record has related data.']
    } else if (this.isPrismaError(exception, PRISMA_UNIQUE_CONSTRAINT_CODE)) {
      status = HttpStatus.CONFLICT
      messages = ['A record with these unique fields already exists.']
    } else if (this.isPrismaError(exception, PRISMA_NOT_FOUND_CODE)) {
      status = HttpStatus.NOT_FOUND
      messages = ['Record not found.']
    } else if (exception instanceof Error) {
      // Непредвиденная ошибка: полную информацию логируем на сервере,
      // клиенту (особенно в production) отдаём только generic-сообщение,
      // чтобы не раскрывать детали БД/стека/инфраструктуры.
      this.logger.error(exception.message, exception.stack)
      messages = isProduction
        ? ['Internal server error']
        : normalizeMessage(exception.message)
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message: messages,
      ...(error ? { error } : {}),
      timestamp: new Date().toISOString(),
    })
  }

  private isPrismaError(exception: unknown, code: string): boolean {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      (exception as { code?: string }).code === code
    )
  }
}
