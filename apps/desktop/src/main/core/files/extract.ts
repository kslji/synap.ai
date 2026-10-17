/**
 * Text from a granted file. Office and PDF go through the existing converters.
 * Code uses tree-sitter symbols when a grammar is installed, otherwise the source text.
 * Images use offline tesseract.js (the app's OCR). Tests pass `ocr` so they do not start Electron.
 */
import { readFile } from 'node:fs/promises'
import { languageFor } from '../code/languages.js'
import { parsePlain, parseSource, type ParseResult } from '../code/parse.js'
import type { Block } from '../chunker.js'
import { convertBytes, type ConvertOptions } from '../convert.js'
import { canReadPath } from './permissions.js'
import { baseName, type PathStyle } from './paths.js'

/** Offline OCR already shipped with the app. */
export const OCR_ENGINE = 'tesseract.js'

export interface ExtractOpts {
  style: PathStyle
  roots: readonly string[]
  grammarDir?: string
  tessdataDir?: string
  tessCacheDir?: string
  ocr?: (bytes: Buffer, name: string) => Promise<string>
  read?: (file: string) => Promise<Buffer>
}

const OFFICE = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'txt', 'md', 'html', 'htm', 'png', 'jpg', 'jpeg'])

export async function readGrantedFile(filePath: string, opts: ExtractOpts): Promise<Buffer> {
  if (!canReadPath(filePath, opts.roots, opts.style)) {
    throw Object.assign(new Error('Synap.surf does not have permission to read that folder.'), { code: 'EPERM', name: 'FilePermissionError' })
  }
  const read = opts.read ?? ((file: string) => readFile(file))
  return read(filePath)
}

export async function extractGrantedFile(filePath: string, opts: ExtractOpts): Promise<Block[]> {
  const bytes = await readGrantedFile(filePath, opts)
  return extractBytes(baseName(filePath), bytes, opts)
}

export async function extractBytes(name: string, bytes: Buffer, opts: ExtractOpts): Promise<Block[]> {
  const ext = extension(name)
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
    if (opts.ocr) {
      const text = (await opts.ocr(bytes, name)).trim()
      if (!text) throw new Error('No text found in this image.')
      return [{ text, heading: null }]
    }
    return convertOffice(name, bytes, opts)
  }
  const lang = languageFor(name)
  if (lang && lang !== 'plaintext') return codeBlocks(bytes.toString('utf8'), lang, opts.grammarDir)
  if (OFFICE.has(ext)) return convertOffice(name, bytes, opts)
  if (lang === 'plaintext') return [{ text: bytes.toString('utf8').slice(0, 8000), heading: null }]
  throw new Error('This file type is not indexed.')
}

async function convertOffice(name: string, bytes: Buffer, opts: ExtractOpts): Promise<Block[]> {
  const convertOpts: ConvertOptions = {
    tessdataDir: opts.tessdataDir ?? '',
    tessCacheDir: opts.tessCacheDir ?? '',
  }
  return convertBytes(name, bytes, convertOpts)
}

async function codeBlocks(source: string, language: string, grammarDir: string | undefined): Promise<Block[]> {
  let parsed: ParseResult
  try {
    parsed = grammarDir ? await parseSource(language, source, grammarDir) : parsePlain(source)
  } catch {
    parsed = parsePlain(source)
  }
  if (!parsed.symbols.length) {
    const text = source.trim().slice(0, 8000)
    return text ? [{ text, heading: null }] : []
  }
  return parsed.symbols.map((symbol) => ({
    text: symbol.text.trim().slice(0, 4000) || symbol.signature,
    heading: `${symbol.kind} ${symbol.qualified}`.trim(),
  })).filter((block) => block.text)
}

function extension(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}
