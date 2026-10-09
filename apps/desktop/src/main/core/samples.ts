/** Small in-memory fixtures for tests. Not a zip pack. */
import { createCanvas } from '@napi-rs/canvas'
import JSZip from 'jszip'

export function makePdf(lines: string[]): Buffer {
  const commands = lines.map((line, index) => {
    const y = 740 - index * 28
    const safe = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    return `BT /F1 16 Tf 72 ${y} Td (${safe}) Tj ET`
  }).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}

export async function makeDocx(paragraphs: { heading?: boolean; text: string }[]): Promise<Buffer> {
  const body = paragraphs.map((p) => {
    const style = p.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''
    return `<w:p>${style}<w:r><w:t xml:space="preserve">${xml(p.text)}</w:t></w:r></w:p>`
  }).join('')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

export async function makePptx(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip()
  slides.forEach((lines, index) => {
    const text = lines.map((line) => `<a:t>${xml(line)}</a:t>`).join('')
    zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld>${text}</p:sld>`)
  })
  return zip.generateAsync({ type: 'nodebuffer' })
}

export function makePng(text: string): Buffer {
  const canvas = createCanvas(1100, 220)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 1100, 220)
  ctx.fillStyle = '#141414'
  ctx.font = 'bold 54px sans-serif'
  ctx.fillText(text, 28, 130)
  return canvas.toBuffer('image/png')
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
