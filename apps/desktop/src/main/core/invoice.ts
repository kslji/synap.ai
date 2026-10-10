/**
 * Invoice totals are integer cents. The rate is applied here, not by the chat model.
 * Templates cover a plain invoice, India GST, US/EU VAT, a freelancer note, and a recurring series.
 */

export type InvoiceTemplate = 'standard' | 'gst-india' | 'vat' | 'freelancer' | 'recurring'

export interface InvoiceLine {
  label: string
  cents: number
}

export interface InvoiceDraft {
  template: InvoiceTemplate
  number: string
  lines: InvoiceLine[]
  ratePercent: number
  subtotalCents: number
  taxCents: number
  totalCents: number
  recurring: boolean
}

const RATES: Record<InvoiceTemplate, number> = {
  standard: 0,
  'gst-india': 18,
  vat: 20,
  freelancer: 0,
  recurring: 0,
}

export function taxCents(subtotalCents: number, ratePercent: number): number {
  return Math.round(subtotalCents * ratePercent / 100)
}

export function nextInvoiceNumber(year: number, last: number): string {
  return `INV-${year}-${String(last + 1).padStart(4, '0')}`
}

export function draftInvoice(template: InvoiceTemplate, lines: InvoiceLine[], year: number, last: number, ratePercent?: number): InvoiceDraft {
  const subtotalCents = lines.reduce((sum, line) => sum + line.cents, 0)
  const rate = ratePercent ?? RATES[template]
  const tax = taxCents(subtotalCents, rate)
  return {
    template,
    number: nextInvoiceNumber(year, last),
    lines,
    ratePercent: rate,
    subtotalCents,
    taxCents: tax,
    totalCents: subtotalCents + tax,
    recurring: template === 'recurring',
  }
}

export function invoiceText(draft: InvoiceDraft): string {
  const lines = draft.lines.map((line) => `${line.label}: ${(line.cents / 100).toFixed(2)}`).join('\n')
  return `${draft.number}\n${draft.template}\n${lines}\nTax ${draft.ratePercent}%: ${(draft.taxCents / 100).toFixed(2)}\nTotal: ${(draft.totalCents / 100).toFixed(2)}`
}

export function scheduleAt(now: Date, day: 'tomorrow', hour: number, minute: number): string {
  const next = new Date(now.getTime())
  next.setUTCDate(next.getUTCDate() + (day === 'tomorrow' ? 1 : 0))
  next.setUTCHours(hour, minute, 0, 0)
  return next.toISOString()
}
