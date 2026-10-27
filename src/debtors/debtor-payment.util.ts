import { round2 } from '../common/utils/period.util'

export interface OpenDebt {
  id: string
  remainingAmount: number
}

export interface PaymentAllocation {
  transactionId: string
  /** Сколько из платежа ушло на этот долг. */
  amount: number
  /** Остаток долга после списания. */
  remainingAfter: number
  /** Долг закрыт полностью. */
  settled: boolean
}

export interface PaymentPlan {
  allocations: PaymentAllocation[]
  /** Сколько платёж превысил общий долг; > 0 — платёж надо отклонить. */
  excess: number
}

/**
 * Раскладывает один платёж должника по его открытым долгам.
 *
 * Долги приходят уже отсортированными от старых к новым — гасим именно в
 * таком порядке (FIFO): так человек сначала закрывает самое просроченное, и
 * риск по нему падает раньше. Чистая функция — без БД, весь расчёт на копейках
 * через round2, чтобы 0.1 + 0.2 не оставляли «хвост» в 0.0000001.
 */
export function planDebtorPayment(debts: OpenDebt[], amount: number): PaymentPlan {
  let left = round2(amount)
  const allocations: PaymentAllocation[] = []

  for (const debt of debts) {
    if (left <= 0) break
    const remaining = round2(debt.remainingAmount)
    if (remaining <= 0) continue

    const applied = Math.min(left, remaining)
    const remainingAfter = round2(remaining - applied)
    allocations.push({
      transactionId: debt.id,
      amount: round2(applied),
      remainingAfter,
      settled: remainingAfter <= 0,
    })
    left = round2(left - applied)
  }

  return { allocations, excess: left }
}
