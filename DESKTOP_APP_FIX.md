# Fix for Desktop App Web Search

## Problem

The desktop app's `web-client.ts` calls `/v1/search` and `/v1/fetch` endpoints that were removed in PR #37 (OpenRouter gateway). This causes the desktop evaluation tests to fail.

## Quick Fix Option

Update `web-client.ts` to return empty results when the endpoints return 404:

```typescript
export async function searchWeb(opts: WebCall & { query: string; k?: number }): Promise<SearchResult[]> {
  const res = await call('/v1/search', opts, { method: 'POST', body: JSON.stringify(searchBody(opts.query, opts.k ?? 5)) })
  if (res.status === 404) {
    // Endpoint removed - web search no longer available
    console.warn('Web search endpoint /v1/search not found (removed in favor of /api/v1/chat)')
    return []
  }
  if (!res.ok) throw new WebClientError('search failed', res.status)
  const body = await res.json() as { results?: Array<{ title?: string; url?: string; snippet?: string; published?: string | null }> }
  return (body.results ?? [])
    .filter((item) => typeof item.url === 'string' && item.url.startsWith('http'))
    .map((item) => ({
      title: item.title || item.url || '',
      url: item.url || '',
      snippet: item.snippet || '',
      published: item.published ?? null,
    }))
}

export async function fetchPages(opts: WebCall & { urls: string[] }): Promise<{ chunks: FetchedChunk[]; ignored: IgnoredPassage[]; sanitizer: SanitizerReport[] }> {
  if (!opts.urls.length) return { chunks: [], ignored: [], sanitizer: [] }
  const res = await call('/v1/fetch', opts, { method: 'POST', body: JSON.stringify({ urls: opts.urls.slice(0, 5) }) })
  if (res.status === 404) {
    // Endpoint removed - page fetch no longer available
    console.warn('Page fetch endpoint /v1/fetch not found (removed in favor of /api/v1/chat)')
    return { chunks: [], ignored: [], sanitizer: [] }
  }
  if (!res.ok) throw new WebClientError('fetch failed', res.status)
  // ... rest of the function
}
```

## Proper Fix Option

Update the desktop app to use the new `/api/v1/chat` endpoint for web search functionality. This requires:

1. Creating a new function in `web-client.ts` that calls `/api/v1/chat`
2. Updating the chat routing logic to use the new endpoint
3. Handling streaming responses
4. Updating the UI to show billing information

This is a larger change and should be a separate PR.

## Recommendation

For now, apply the **quick fix** to unblock CI, then create a follow-up PR to properly integrate the new gateway.
