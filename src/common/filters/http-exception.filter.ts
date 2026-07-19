import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
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
    } else if (exception instanceof Error) {
      messages = normalizeMessage(exception.message)
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message: messages,
      ...(error ? { error } : {}),
      timestamp: new Date().toISOString(),
    })
  }
}
