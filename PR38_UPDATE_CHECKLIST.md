# PR #38 Update: Remove Old Search Infrastructure

## ✅ Completed Changes

1. ✅ Removed `services/api/app/pages.py`
2. ✅ Removed `services/api/app/ssrf.py`
3. ✅ Removed `services/api/app/sanitize.py`
4. ✅ Removed `deploy/searxng/` directory
5. ✅ Removed `trafilatura` from `requirements.txt`

## ⏳ Remaining Changes Needed

### 1. Update `services/api/app/main.py`

**Remove imports (lines 32-33):**
```python
from .pages import fetch_one
from .ssrf import SsrfBlocked
```

**Remove search-related functions and endpoints:**
- `search_gate()` function (around line 157)
- `SearchIn` model class
- `search()` endpoint (lines 401-441)
- `filter_domains()` function
- `cache_key()` function
- `read_cache()` / `write_cache()` functions
- `remember()` function
- `allow_hosts()` function
- `FetchIn` model class
- `fetch_pages()` endpoint (lines 667-699)

**Update docstring (line 1):**
```python
"""Surf AI API: login, devices, pack catalog, and OpenRouter chat gateway.

Privacy: chat prompts are sent to OpenRouter and stored server-side scoped by user ID.
Access tokens are minted at email login. `sub` is the device id.
"""
```

### 2. Update Docker Compose Files

**`deploy/docker-compose.yml`:**
- Remove `searxng` service (lines ~20-30)
- Remove `searxng` from `api.depends_on`

**`deploy/docker-compose.dev.yml`:**
- Remove `searxng` service
- Remove `SEARXNG_URL` environment variable
- Remove `searxng` from `api.depends_on`

### 3. Update Environment Files

**`deploy/.env.example`:**
- Remove `SEARXNG_URL`
- Remove `SEARXNG_SECRET`
- Remove `SEARCH_PER_MIN`
- Remove `SEARCH_PER_DAY`
- Remove `SEARCH_CACHE_TTL`
- Remove `FETCH_ALLOW_HOSTS`

### 4. Fix Desktop App

**`apps/desktop/src/main/core/web-client.ts`:**

Update `searchWeb()` function (line 73):
```typescript
export async function searchWeb(opts: WebCall & { query: string; k?: number }): Promise<SearchResult[]> {
  const res = await call('/v1/search', opts, { method: 'POST', body: JSON.stringify(searchBody(opts.query, opts.k ?? 5)) })
  if (res.status === 404) {
    console.warn('Web search endpoint removed. Use POST /api/v1/chat instead.')
    return []
  }
  if (!res.ok) throw new WebClientError('search failed', res.status)
  // ... rest of function
}
```

Update `fetchPages()` function (line 87):
```typescript
export async function fetchPages(opts: WebCall & { urls: string[] }): Promise<{ chunks: FetchedChunk[]; ignored: IgnoredPassage[]; sanitizer: SanitizerReport[] }> {
  if (!opts.urls.length) return { chunks: [], ignored: [], sanitizer: [] }
  const res = await call('/v1/fetch', opts, { method: 'POST', body: JSON.stringify({ urls: opts.urls.slice(0, 5) }) })
  if (res.status === 404) {
    console.warn('Page fetch endpoint removed. Use POST /api/v1/chat instead.')
    return { chunks: [], ignored: [], sanitizer: [] }
  }
  if (!res.ok) throw new WebClientError('fetch failed', res.status)
  // ... rest of function
}
```

### 5. Update Documentation

**`README.md` (root):**
- Remove "Web search on your laptop" section
- Update to mention OpenRouter gateway instead

**`services/api/README.md`:**
- Update to reflect new gateway functionality
- Remove SearXNG references

**`docs/STEP-3.md`:**
- Update references to `npm run dev:search`
- Change to `npm run dev:api`

### 6. Update CI Workflow

**`.github/workflows/ci.yml`:**
- Rename "Search API tests" to "API tests" (already done by Devin)
- Remove any SearXNG-related steps

### 7. Update package.json Scripts

**`package.json` (root):**
- Rename `dev:search` to `dev:api` (if not already done)

## 📝 Commit Message

```
refactor(api): remove SearXNG search infrastructure, replace with OpenRouter gateway

BREAKING CHANGE: /v1/search and /v1/fetch endpoints removed

- Remove pages.py, ssrf.py, sanitize.py (no longer needed)
- Remove SearXNG Docker service and configuration
- Remove trafilatura dependency
- Remove search-related functions from main.py
- Update desktop app to handle 404s gracefully
- Update documentation to reflect new architecture

Users should now use POST /api/v1/chat for all LLM interactions.
See docs/adr/0005-openrouter-gateway.md for details.
```

## ✅ Testing Checklist

After making all changes:

1. Run API tests: `cd services/api && pytest tests/test_gateway.py -v`
2. Check alembic: `cd services/api && alembic heads`
3. Validate Docker: `docker compose -f deploy/docker-compose.yml config`
4. Typecheck desktop: `npm run typecheck -w @surf/desktop`
5. Run desktop tests (if they exist)

## 🚀 Push to PR #38

```bash
git add -A
git commit -m "refactor(api): remove SearXNG search infrastructure

BREAKING CHANGE: /v1/search and /v1/fetch endpoints removed

- Remove old search files (pages.py, ssrf.py, sanitize.py)
- Remove SearXNG Docker service
- Remove trafilatura dependency
- Update desktop app to handle 404s
- Update documentation

Replaced by OpenRouter gateway at POST /api/v1/chat (ADR 0005)"

git push origin feature/openrouter-gateway
```
