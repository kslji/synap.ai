/**
 * Invoice files reuse the document exporters: pdf-lib via buildPlainPdf,
 * OOXML via buildDocx, and sheetBytes for xlsx. Amounts stay in integer cents.
 */
import { buildDocx, buildPlainPdf, sheetBytes, type RunProps } from './document-files.js'
import { invoiceText, type InvoiceDraft } from './invoice.js'

const BODY: RunProps = { font: 'Calibri', sizeHalfPoints: 24, color: '111111', bold: false, italic: false }
const TITLE: RunProps = { ...BODY, bold: true, sizeHalfPoints: 32 }

function money(cents: number): string {
  return (cents / 100).toFixed(2)
}

function pdfLine(text: string): string {
  return [...text].map((char) => (char.charCodeAt(0) <= 255 ? char : '?')).join('')
}

export function invoiceRows(draft: InvoiceDraft): string[][] {
  const rows = [
    ['Number', draft.number],
    ['Template', draft.template],
    ['Label', 'Amount'],
    ...draft.lines.map((line) => [line.label, money(line.cents)]),
    ['Tax', `${draft.ratePercent}% ${money(draft.taxCents)}`],
    ['Total', money(draft.totalCents)],
  ]
  return rows
}

export async function invoicePdf(draft: InvoiceDraft): Promise<Buffer> {
  const lines = invoiceText(draft).split('\n').map((text, index) => ({
    text: pdfLine(text),
    x: 72,
    y: 740 - index * 22,
    size: index === 0 ? 16 : 12,
  }))
  return buildPlainPdf(lines)
}

export async function invoiceDocx(draft: InvoiceDraft): Promise<Buffer> {
  const paragraphs = [
    { text: draft.number, props: TITLE },
    { text: draft.template, props: BODY },
    ...draft.lines.map((line) => ({ text: `${line.label}: ${money(line.cents)}`, props: BODY })),
    { text: `Tax ${draft.ratePercent}%: ${money(draft.taxCents)}`, props: BODY },
    { text: `Total: ${money(draft.totalCents)}`, props: { ...BODY, bold: true } },
  ]
  return buildDocx(paragraphs)
}

export function invoiceXlsx(draft: InvoiceDraft): Buffer {
  return sheetBytes(invoiceRows(draft))
}
