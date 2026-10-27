/**
 * Приводит телефон к виду «+цифры»: убирает пробелы, скобки и дефисы.
 * Один и тот же номер, введённый по-разному, иначе не находится поиском
 * и не ловится предупреждением о дубле.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return raw.trim().startsWith('+') ? `+${digits}` : digits
}

/** Номер валиден, если в нём 7–15 цифр (E.164). */
export function isValidPhone(normalized: string): boolean {
  const digits = normalized.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}
