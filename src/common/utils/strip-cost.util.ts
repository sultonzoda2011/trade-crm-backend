/**
 * Убирает закупочную цену (`costPrice`) из любого ответа, рекурсивно.
 *
 * Закупочная цена — данные владельца: по ней считается прибыль. Продавец
 * читает каталог (он нужен ему для оформления долга), но видеть, по чём товар
 * куплен, не должен. Помощник применяется в контроллере к ответу сервиса,
 * поэтому не важно, какой формы результат: товар, страница списка или
 * товар с метриками.
 */
export function stripCostPrice<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map(item => stripCostPrice(item)) as unknown as T
	}
	if (value instanceof Date || value === null || typeof value !== 'object') {
		return value
	}
	const result: Record<string, unknown> = {}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (key === 'costPrice') continue
		result[key] = stripCostPrice(nested)
	}
	return result as T
}
