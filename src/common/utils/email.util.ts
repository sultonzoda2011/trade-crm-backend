import { Transform } from 'class-transformer'

/** Email без регистра и пробелов по краям: `  Ali@Mail.com ` → `ali@mail.com`. */
export function normalizeEmail(value: string): string {
	return value.trim().toLowerCase()
}

/**
 * Для DTO: приводит строку к нормализованному виду до валидации.
 * Вход и профиль не различают регистр, а в базе у старых пользователей email
 * мог быть записан с заглавными — поэтому ПОИСК по email везде делается с
 * `mode: 'insensitive'`, а данные в базе мы не переписываем.
 */
export const NormalizeEmail = () =>
	Transform(({ value }) => (typeof value === 'string' ? normalizeEmail(value) : value))
