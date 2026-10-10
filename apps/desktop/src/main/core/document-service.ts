/**
 * Convert and fill from the library or a path the user picked.
 * Writes a new file. The bytes that were read are never written back.
 */
import { app, BrowserWindow, dialog } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import type { Calculator } from './calculator.js'
import { convertDocument, detectConvertIntent, type ExportFormat } from './document-export.js'
import { siblingCopyPath } from './document-files.js'
import { applyCalculator, exportFilled, planDocument } from './document-fill.js'
import type { DB } from './db.js'
import { IPC, type DocumentEvent, type DocumentResult, type ExportFormat as ContractFormat, type FillPlan, type FillRow } from './ipc-contract.js'

const MAX_BYTES = 40 * 1024 * 1024

export interface FileRef {
  path?: string
  attachmentId?: string
}

interface LoadedFile {
  name: string
  full: string
  bytes: Buffer
  library: boolean
  attachmentId: string | null
}

export interface DocumentApi {
  pick(win: BrowserWindow, title: string): Promise<string | null>
  convert(win: BrowserWindow, input: FileRef, format: ContractFormat): Promise<DocumentResult | null>
  plan(input: { templatePath?: string; templateAttachmentId?: string; sourcePath?: string; sourceAttachmentId?: string }): Promise<FillPlan>
  export(win: BrowserWindow, input: FileRef, rows: FillRow[], format: ContractFormat | 'same', highlight: boolean): Promise<DocumentResult | null>
  cancel(): void
  convertChat(conversationId: string, text: string, cancelled: () => boolean): Promise<string | null>
}

export function createDocumentApi(opts: {
  db: () => DB | null
  attachmentsRoot: () => string
  calc: Calculator
}): DocumentApi {
  let cancel = false

  function emit(win: BrowserWindow, event: DocumentEvent): void {
    if (!win.isDestroyed()) win.webContents.send(IPC.documentsEvent, event)
  }

  function load(ref: FileRef): LoadedFile {
    if (ref.attachmentId) {
      const db = opts.db()
      if (!db) throw new Error('Encrypted storage is not available on this computer.')
      const row = db.prepare(
        'SELECT original_name AS name, stored_path AS stored FROM attachments WHERE id = ?',
      ).get(ref.attachmentId) as { name: string; stored: string } | undefined
      if (!row) throw new Error('That document is not in the library.')
      const root = resolve(opts.attachmentsRoot())
      const full = resolve(root, row.stored)
      if (full !== root && !full.startsWith(root + sep)) throw new Error('That document is not in the library.')
      return { name: row.name, full, bytes: readFileSync(full), library: true, attachmentId: ref.attachmentId }
    }
    if (!ref.path) throw new Error('Choose a file.')
    const full = resolve(ref.path)
    if (!existsSync(full)) throw new Error('That file is not on this computer.')
    const info = statSync(full)
    if (!info.isFile()) throw new Error('Choose a file, not a folder.')
    if (info.size > MAX_BYTES) throw new Error('Choose a document under 40 MB.')
    return { name: basename(full), full, bytes: readFileSync(full), library: false, attachmentId: null }
  }

  async function saveCopy(win: BrowserWindow, source: LoadedFile, suggested: string): Promise<string | null> {
    const ext = extname(suggested).replace(/^\./, '') || 'bin'
    const beside = source.library
      ? join(app.getPath('documents'), suggested)
      : siblingCopyPath(source.full, ext)
    const picked = await dialog.showSaveDialog(win, {
      title: 'Save a copy',
      defaultPath: beside,
      buttonLabel: 'Save copy',
    })
    if (picked.canceled || !picked.filePath) return null
    if (resolve(picked.filePath) === resolve(source.full)) {
      throw new Error('The original file is not modified. Choose a different name.')
    }
    return picked.filePath
  }

  async function numbers(rows: FillRow[]): Promise<FillRow[]> {
    return applyCalculator(rows, async (expression) => {
      const result = await opts.calc.calc(expression)
      return result.ok ? result.result : null
    })
  }

  return {
    cancel() { cancel = true },
    async pick(win, title) {
      const picked = await dialog.showOpenDialog(win, {
        title,
        properties: ['openFile'],
        filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'md', 'html', 'htm', 'png', 'jpg', 'jpeg'] }],
      })
      if (picked.canceled || !picked.filePaths[0]) return null
      return picked.filePaths[0]
    },
    async convert(win, input, format) {
      cancel = false
      const source = load(input)
      try {
        emit(win, { progress: 0.05, stage: 'Reading', done: false })
        const converted = await convertDocument(source.name, source.bytes, format as ExportFormat, {
          cancelled: () => cancel,
          onProgress: (ratio, stage) => emit(win, { progress: ratio, stage, done: false }),
        })
        if (cancel) throw new Error('Cancelled')
        const output = await saveCopy(win, source, converted.name)
        if (!output) {
          emit(win, { progress: 0, stage: 'Not saved', done: true })
          return null
        }
        writeFileSync(output, converted.bytes)
        emit(win, { progress: 1, stage: 'Saved', done: true })
        return { outputPath: output, warnings: converted.warnings }
      } catch (error) {
        const message = (error as Error).message
        emit(win, { progress: 0, stage: 'Stopped', done: true, error: message })
        throw error
      }
    },
    async plan(input) {
      let template = load({ path: input.templatePath, attachmentId: input.templateAttachmentId })
      let source = load({ path: input.sourcePath, attachmentId: input.sourceAttachmentId })
      let planned = await planDocument(template.name, template.bytes, source.name, source.bytes)
      if (planned.role === 'source-first') {
        const swap = template
        template = source
        source = swap
        planned = await planDocument(template.name, template.bytes, source.name, source.bytes)
        planned.warnings.unshift('The second file has the blanks, so it is the form.')
      }
      planned.rows = await numbers(planned.rows)
      if (extname(template.name).toLowerCase() === '.pdf' && planned.rows.length === 0) {
        planned.warnings.push('This PDF has no blanks in the text layer and no empty form fields. A scan needs the page saved as an image.')
      }
      return {
        templatePath: template.library ? null : template.full,
        templateAttachmentId: template.attachmentId,
        sourcePath: source.library ? null : source.full,
        sourceAttachmentId: source.attachmentId,
        templateName: template.name,
        sourceName: source.name,
        role: planned.role,
        rows: planned.rows,
        warnings: planned.warnings,
      }
    },
    async export(win, input, rows, format, highlight) {
      cancel = false
      const template = load(input)
      try {
        emit(win, { progress: 0.2, stage: 'Filling', done: false })
        if (cancel) throw new Error('Cancelled')
        const filled = await exportFilled(template.name, template.bytes, rows, format, highlight)
        if (cancel) throw new Error('Cancelled')
        const ext = format === 'same' ? (extname(template.name).slice(1) || 'bin') : (format === 'jpeg' ? 'jpg' : format)
        const stem = basename(template.name, extname(template.name))
        const output = await saveCopy(win, template, `${stem}-filled.${ext}`)
        if (!output) {
          emit(win, { progress: 0, stage: 'Not saved', done: true })
          return null
        }
        writeFileSync(output, filled.bytes)
        emit(win, { progress: 1, stage: 'Saved', done: true })
        return { outputPath: output, warnings: filled.warnings }
      } catch (error) {
        const message = (error as Error).message
        emit(win, { progress: 0, stage: 'Stopped', done: true, error: message })
        throw error
      }
    },
    async convertChat(conversationId, text, cancelled) {
      const format = detectConvertIntent(text)
      if (!format) return null
      const db = opts.db()
      if (!db) return 'Add the document first. The original file is not changed.'
      const rows = db.prepare(
        `SELECT a.id AS id, a.original_name AS name
         FROM conversation_files cf
         JOIN attachments a ON a.id = cf.attachment_id
         WHERE cf.conversation_id = ?
         ORDER BY cf.added_at DESC`,
      ).all(conversationId) as { id: string; name: string }[]
      const named = rows.find((row) => text.toLowerCase().includes(row.name.toLowerCase()))
      const chosen = named ?? rows[0]
      if (!chosen) return 'Add the document first. I can convert PDF, Word, text, HTML, and images. The original file is not changed.'
      const source = load({ attachmentId: chosen.id })
      const converted = await convertDocument(source.name, source.bytes, format, { cancelled })
      const dir = join(app.getPath('userData'), 'conversions')
      mkdirSync(dir, { recursive: true })
      const output = siblingCopyPath(join(dir, source.name), extname(converted.name).slice(1) || format)
      writeFileSync(output, converted.bytes)
      const warning = converted.warnings[0] ? ` ${converted.warnings[0]}` : ''
      return `Saved ${converted.name} at ${output}. The original file was not changed.${warning}`
    },
  }
}
