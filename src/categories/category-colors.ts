/**
 * Палитра цветов-меток категории. В БД хранится ключ, а не hex: фронт сам
 * подбирает оттенок под светлую и тёмную тему. Ключи должны совпадать с
 * `CATEGORY_COLORS` на фронте (`app/config/categoryColors.ts`).
 */
export const CATEGORY_COLORS = [
	'blue',
	'green',
	'orange',
	'red',
	'purple',
	'pink',
	'teal',
	'indigo',
	'yellow',
	'gray'
] as const

export type CategoryColor = (typeof CATEGORY_COLORS)[number]
