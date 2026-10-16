/**
 * Page text is cleaned on this computer.
 * Readability pulls the article. Turndown turns it into markdown.
 * A hidden window is used only when the static extract is too short to be the article.
 */
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'
import { politeFetch, type PoliteOpts } from './http.js'

export const PAGE_MAX_BYTES = 1_000_000
export const PAGE_TEXT_CAP = 8_000
export const PAGE_FETCH_MS = 8_000
export const JS_TEXT_MIN = 280

const TRACKERS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'googleadservices.com',
  'facebook.net',
  'facebook.com/tr',
  'scorecardresearch.com',
  'hotjar.com',
  'segment.io',
  'mixpanel.com',
  'clarity.ms',
]

export function stripTrackers(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<img\b[^>]*(?:width\s*=\s*["']?1["']?|height\s*=\s*["']?1["']?)[^>]*>/gi, '')
  for (const host of TRACKERS) {
    const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`<img\\b[^>]*${escaped}[^>]*>`, 'gi'), '')
    out = out.replace(new RegExp(`<link\\b[^>]*${escaped}[^>]*>`, 'gi'), '')
    out = out.replace(new RegExp(`<script\\b[^>]*${escaped}[^>]*>[\\s\\S]*?<\\/script>`, 'gi'), '')
  }
  return out
}

export function pageToMarkdown(html: string, _url: string): { title: string; markdown: string; jsNeeded: boolean } {
  const cleaned = stripTrackers(html).slice(0, PAGE_MAX_BYTES)
  try {
    const { document } = parseHTML(cleaned)
    const article = new Readability(document as never, { charThreshold: 80 }).parse()
    const title = (article?.title || document.title || '').trim()
    const content = article?.content || ''
    const markdown = content ? new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(content) : ''
    const text = markdown.replace(/\s+/g, ' ').trim().slice(0, PAGE_TEXT_CAP)
    return { title, markdown: text, jsNeeded: text.length < JS_TEXT_MIN }
  } catch {
    const text = cleaned.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PAGE_TEXT_CAP)
    return { title: '', markdown: text, jsNeeded: text.length < JS_TEXT_MIN }
  }
}

export interface ReadOpts extends Pick<PoliteOpts, 'offlineOnly' | 'fetchImpl' | 'signal'> {
  jsRender?: (url: string) => Promise<string | null>
  html?: string
}

export async function readPage(url: string, opts: ReadOpts): Promise<{ url: string; title: string; markdown: string } | null> {
  let html = opts.html ?? ''
  if (!html) {
    const res = await politeFetch(url, { ...opts, timeoutMs: PAGE_FETCH_MS, perMinute: 20, headers: { accept: 'text/html' } })
    if (!res) return null
    html = (await res.text()).slice(0, PAGE_MAX_BYTES)
  } else {
    html = html.slice(0, PAGE_MAX_BYTES)
  }
  let parsed = pageToMarkdown(html, url)
  if (parsed.jsNeeded && opts.jsRender) {
    try {
      const rendered = await opts.jsRender(url)
      if (rendered) {
        const second = pageToMarkdown(rendered.slice(0, PAGE_MAX_BYTES), url)
        if (second.markdown.length > parsed.markdown.length) parsed = { ...second, jsNeeded: false }
      }
    } catch {
      /* the static extract still stands */
    }
  }
  if (!parsed.markdown.trim()) return null
  return { url, title: parsed.title || url, markdown: parsed.markdown }
}
