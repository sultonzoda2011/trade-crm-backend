/** Правило пароля: от 8 символов, есть строчная, заглавная и цифра. */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/
export const PASSWORD_PATTERN_MESSAGE =
	'Password must contain at least one lowercase, one uppercase, and one digit'
