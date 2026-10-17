/**
 * Licence lengths the app already describes. Amounts stay empty until a real price is set.
 * Do not put a number here.
 */
export interface LicenceTerm {
  id: string
  months: number
  amount: null
}

export const licenceTerms: readonly LicenceTerm[] = [
  { id: 'month-1', months: 1, amount: null },
  { id: 'month-3', months: 3, amount: null },
  { id: 'month-6', months: 6, amount: null },
  { id: 'month-12', months: 12, amount: null },
]

export const PRICING_NOTICE = 'Pricing coming soon'

export function termPrice(term: { amount: string | null }): string {
  return term.amount ?? PRICING_NOTICE
}
