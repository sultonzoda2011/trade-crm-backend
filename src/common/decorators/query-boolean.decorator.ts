import { Transform } from 'class-transformer'

/**
 * Разбор булева query-параметра: 'true' / '1' → true, 'false' / '0' → false.
 *
 * Почему не `@Type(() => Boolean)`: он вызывает `Boolean('false')`, а это `true` —
 * непустая строка истинна. Фильтр «нет активных долгов» (`?hasActiveDebts=false`)
 * молча превращался в «есть». Глобальный ValidationPipe включает
 * `enableImplicitConversion`, который тоже приводит значение так же, поэтому
 * читаем исходное значение из `obj`, а не уже приведённое.
 *
 * Непонятное значение возвращаем как есть — `@IsBoolean()` ответит 400.
 */
export function parseQueryBoolean(raw: unknown): unknown {
  if (raw === true || raw === 'true' || raw === '1') return true
  if (raw === false || raw === 'false' || raw === '0') return false
  return raw
}

export function QueryBoolean(): PropertyDecorator {
  return Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
    parseQueryBoolean(obj[key]),
  )
}
