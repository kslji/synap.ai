/**
 * Lightweight local web fetcher - no Docker, no external services.
 * Fetches web pages directly using HTTP client in-process.
 * Much lighter than SearXNG + FastAPI stack.
 */
import * as https from 'node:https'
import { parseHTML } from 'linkedom'
import { assertPublicUrl } from './dev-web-tools.js'

export interface WebPage {
  url: string
  title: string
  content: string
  status: number
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
}

/**
 * Fetch a single web page and extract main content.
 * This is much lighter than running a full search engine.
 */
export async function fetchWebPage(url: string): Promise<WebPage> {
  const publicUrl = await assertPublicUrl(url)
  return new Promise((resolve, reject) => {
    const request = https.get(publicUrl, (response) => {
      let data = ''

      response.on('data', (chunk) => {
        data += chunk
      })

      response.on('end', () => {
        try {
          const document = parseHTML(data).document

          // Extract title
          const title = document.querySelector('title')?.textContent || 'No title'

          // Extract main content (remove scripts, styles, nav, footer)
          const unwanted = document.querySelectorAll('script, style, nav, footer, header, aside')
          unwanted.forEach(el => el.remove())

          const body = document.body?.textContent || ''
          const content = body.replace(/\s+/g, ' ').trim()

          resolve({
            url: publicUrl,
            title,
            content: content.substring(0, 10000), // Limit to 10k chars
            status: response.statusCode || 200
          })
        } catch (error) {
          reject(error)
        }
      })
    })

    request.on('error', reject)
    request.setTimeout(10000, () => {
      request.destroy()
      reject(new Error('Request timeout'))
    })
  })
}

/**
 * Simple search using DuckDuckGo HTML page (no API key needed).
 * This is lightweight and doesn't require Docker.
 */
export async function simpleWebSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query)
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`

    const request = https.get(url, (response) => {
      let data = ''

      response.on('data', (chunk) => {
        data += chunk
      })

      response.on('end', () => {
        try {
          const document = parseHTML(data).document

          // DuckDuckGo HTML results have specific structure
          const results: SearchResult[] = []
          const resultElements = document.querySelectorAll('.result')

          for (let i = 0; i < Math.min(resultElements.length, maxResults); i++) {
            const element = resultElements[i]
            const link = element.querySelector('a.result__a')
            const snippet = element.querySelector('.result__snippet')

            if (link && snippet) {
              results.push({
                url: link.getAttribute('href') || '',
                title: link.textContent || '',
                snippet: snippet.textContent || ''
              })
            }
          }

          resolve(results)
        } catch (error) {
          reject(error)
        }
      })
    })

    request.on('error', reject)
    request.setTimeout(10000, () => {
      request.destroy()
      reject(new Error('Search timeout'))
    })
  })
}

/**
 * Fetch and combine multiple pages for comprehensive search.
 */
export async function fetchMultiplePages(urls: string[]): Promise<WebPage[]> {
  const results: WebPage[] = []
  const batchSize = 3 // Fetch 3 at a time to avoid overwhelming

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize)
    const promises = batch.map(url => fetchWebPage(url).catch(e => {
      console.error(`Failed to fetch ${url}:`, e)
      return null
    }))
    const batchResults = await Promise.all(promises)
    results.push(...batchResults.filter((r): r is WebPage => r !== null))
  }

  return results
}
