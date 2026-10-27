import { round2 } from '../common/utils/period.util'

export type LedgerEventType = 'DEBT' | 'PAYMENT'

export interface LedgerDebtInput {
  id: string
  totalAmount: number
  createdAt: Date
  dueDate: Date | null
  createdByName: string | null
  /** Названия товаров для подписи строки «за что долг». */
  itemNames: string[]
}

export interface LedgerPaymentInput {
  id: string
  transactionId: string
  amount: number
  note: string | null
  createdAt: Date
  createdByName: string | null
}

export interface LedgerEvent {
  type: LedgerEventType
  id: string
  transactionId: string
  /** Выдача — положительное число, оплата — тоже положительное; знак задаёт type. */
  amount: number
  /** Сколько человек должен сразу после этого события. */
  balanceAfter: number
  at: Date
  dueDate: Date | null
  note: string | null
  itemNames: string[]
  createdByName: string | null
}

/**
 * Единая лента должника: выдачи и оплаты в хронологическом порядке с
 * остатком после каждого события — то, что раньше было строкой бумажной
 * тетради. Возвращает от новых к старым.
 *
 * Остаток считается из событий, а не берётся из remainingAmount: так лента
 * внутренне сходится (каждая строка = прошлая ± сумма) и показывает путь долга.
 * Если OWNER потом правил сумму транзакции, итог ленты может разойтись с
 * профилем — профиль остаётся источником правды для «сколько должен сейчас».
 */
export function buildDebtorLedger(
  debts: LedgerDebtInput[],
  payments: LedgerPaymentInput[],
): LedgerEvent[] {
  const events: Array<Omit<LedgerEvent, 'balanceAfter'>> = [
    ...debts.map(debt => ({
      type: 'DEBT' as const,
      id: debt.id,
      transactionId: debt.id,
      amount: round2(debt.totalAmount),
      at: debt.createdAt,
      dueDate: debt.dueDate,
      note: null,
      itemNames: debt.itemNames,
      createdByName: debt.createdByName,
    })),
    ...payments.map(payment => ({
      type: 'PAYMENT' as const,
      id: payment.id,
      transactionId: payment.transactionId,
      amount: round2(payment.amount),
      at: payment.createdAt,
      dueDate: null,
      note: payment.note,
      itemNames: [],
      createdByName: payment.createdByName,
    })),
  ]

  // При равном времени выдача идёт раньше оплаты, иначе остаток уйдёт в минус.
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.type === b.type ? 0 : a.type === 'DEBT' ? -1 : 1))

  let balance = 0
  const withBalance = events.map(event => {
    balance = round2(balance + (event.type === 'DEBT' ? event.amount : -event.amount))
    return { ...event, balanceAfter: balance }
  })

  return withBalance.reverse()
}
