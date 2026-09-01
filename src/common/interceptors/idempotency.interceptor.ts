import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable, of, tap } from 'rxjs'
import { PrismaService } from '../../prisma/prisma.service'
import { JwtPayload } from '../../interfaces'

// Применяется точечно (@UseInterceptors(IdempotencyInterceptor)) на мутациях,
// где офлайн-клиент может повторно отправить один и тот же запрос:
// create/pay/refund транзакций. Не глобальный — остальные эндпоинты не трогает.
//
// Контракт: клиент присылает заголовок Idempotency-Key (uuid, генерируется
// один раз при постановке мутации в локальную очередь и переиспользуется на
// каждой попытке отправки этой же записи).
//
// - Ключ отсутствует -> пропускаем как обычно (эндпоинт остаётся рабочим и
//   без него, для обратной совместимости и для запросов не из очереди).
// - Ключ уже есть в базе -> запрос точно уже был обработан: возвращаем
//   сохранённый ответ, не выполняя бизнес-логику повторно.
// - Ключ новый -> выполняем запрос как обычно и сохраняем результат.
//   Запись делаем ДО выполнения хендлера (со статусом "в процессе" через
//   уникальный constraint), чтобы почти одновременные дубли (двойной тап,
//   гонка при синке) тоже ловились, а не только последовательные ретраи.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest()
    const key = request.headers['idempotency-key'] as string | undefined

    if (!key) {
      return next.handle()
    }

    const user = request.user as JwtPayload | undefined
    const endpoint = `${request.method} ${request.route?.path ?? request.url}`

    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } })
    if (existing) {
      // Уже обработан ранее — отдаём тот же ответ, бизнес-логику не трогаем.
      return of(existing.response)
    }

    try {
      // Резервируем ключ сразу, до выполнения хендлера: конкурентный дубль
      // (например, synk и ручной повтор одновременно) упадёт на unique
      // constraint и получит понятную 409, а не создаст вторую транзакцию.
      await this.prisma.idempotencyKey.create({
        data: {
          key,
          userId: user?.id ?? 'unknown',
          endpoint,
          statusCode: 0,
          response: {},
        },
      })
    } catch {
      throw new ConflictException('This request is already being processed')
    }

    return next.handle().pipe(
      tap({
        next: async (data) => {
          await this.prisma.idempotencyKey.update({
            where: { key },
            data: { statusCode: 200, response: data as object },
          })
        },
        error: async () => {
          // Хендлер упал по бизнес-причине (валидация, недостаточно товара
          // и т.п.) — освобождаем ключ, чтобы клиент мог легитимно повторить
          // попытку после исправления, а не был заблокирован навсегда.
          await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined)
        },
      }),
    )
  }
}
