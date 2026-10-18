import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable, catchError, concatMap, from, of, throwError } from 'rxjs'
import { PrismaService } from '../../prisma/prisma.service'
import { JwtPayload } from '../../interfaces'

// Применяется точечно (@UseInterceptors(IdempotencyInterceptor)) на мутациях,
// где офлайн-клиент может повторно отправить один и тот же запрос:
// create/pay/refund транзакций и создание должника. Не глобальный —
// остальные эндпоинты не трогает.
//
// Контракт: клиент присылает заголовок Idempotency-Key (uuid, генерируется
// один раз при постановке мутации в локальную очередь и переиспользуется на
// каждой попытке отправки этой же записи).
//
// - Ключ отсутствует -> пропускаем как обычно (эндпоинт остаётся рабочим и
//   без него, для обратной совместимости и для запросов не из очереди).
// - Ключ уже есть и операция завершена -> запрос точно уже был обработан:
//   возвращаем сохранённый ответ, не выполняя бизнес-логику повторно.
// - Ключ есть, но операция ещё выполняется (statusCode 0) -> 409. Клиент
//   считает 409 временной ошибкой и повторит позже. Отдавать здесь пустой
//   ответ нельзя: клиент принял бы его за успех и не получил бы id созданной
//   записи (например, id нового должника для следующей продажи).
// - Ключ новый -> резервируем его ДО выполнения хендлера (уникальный
//   constraint), чтобы почти одновременные дубли (двойной тап, гонка при
//   синке) тоже ловились, выполняем запрос и сохраняем результат.
//
// Ответ сохраняется ДО того, как уйдёт клиенту: если сохранение упало, клиент
// получит ошибку и повторит запрос, а не успех, который потом нечем подтвердить.

// Резервация, которая висит дольше, — след упавшего процесса (хендлер никогда
// не завершится), а не работающий запрос. Её можно занять заново, иначе клиент
// получал бы 409 бесконечно.
export const IDEMPOTENCY_STALE_AFTER_MS = 120_000

const PRISMA_UNIQUE_CONSTRAINT_CODE = 'P2002'

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_CODE

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
    const userId = user?.id ?? 'unknown'
    const endpoint = `${request.method} ${request.route?.path ?? request.url}`

    const replay = await this.findReplay(key, userId)
    if (replay.kind === 'done') {
      return of(replay.response)
    }

    try {
      // Резервируем ключ сразу, до выполнения хендлера.
      await this.prisma.idempotencyKey.create({
        data: { key, userId, endpoint, statusCode: 0, response: {} },
      })
    } catch (error) {
      // Нарушение уникальности — значит, параллельный дубль успел раньше.
      // Любая другая ошибка БД — не «дубль», её нельзя прятать под 409.
      if (!isUniqueViolation(error)) throw error
      throw new ConflictException('This request is already being processed')
    }

    return next.handle().pipe(
      concatMap((data) =>
        from(
          this.prisma.idempotencyKey.update({
            where: { key },
            data: { statusCode: 200, response: (data ?? {}) as object },
          }),
        ).pipe(concatMap(() => of(data))),
      ),
      catchError((error) =>
        // Хендлер упал по бизнес-причине (валидация, недостаточно товара и т.п.)
        // — освобождаем ключ, чтобы клиент мог легитимно повторить попытку
        // после исправления, а не был заблокирован навсегда.
        from(this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined)).pipe(
          concatMap(() => throwError(() => error)),
        ),
      ),
    )
  }

  // Что делать с уже существующим ключом: отдать сохранённый ответ, отказать
  // (ещё выполняется / чужой ключ) или освободить протухшую резервацию.
  private async findReplay(
    key: string,
    userId: string,
  ): Promise<{ kind: 'done'; response: unknown } | { kind: 'none' }> {
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } })
    if (!existing) return { kind: 'none' }

    // Ключ — uuid клиента, но чужой ответ по нему отдавать нельзя в любом случае.
    if (existing.userId !== userId) {
      throw new ConflictException('Idempotency key is already used')
    }

    if (existing.statusCode !== 0) {
      return { kind: 'done', response: existing.response }
    }

    const age = Date.now() - existing.createdAt.getTime()
    if (age < IDEMPOTENCY_STALE_AFTER_MS) {
      throw new ConflictException('This request is already being processed')
    }

    // Резервация протухла: хендлер её уже не завершит. Освобождаем и даём
    // выполнить запрос заново. deleteMany — безопасно, если её убрали параллельно;
    // из двух одновременных клиентов один выиграет create, второй получит 409.
    await this.prisma.idempotencyKey.deleteMany({ where: { key, statusCode: 0 } })
    return { kind: 'none' }
  }
}
