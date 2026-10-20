# ADR 0005 — OpenRouter chat gateway with per-user micro-billing

## Status

Accepted

## Context

Many users share one master OpenRouter API key, so the backend must meter each user's spend and never let the master account go negative. The previous web-browsing infrastructure (SearXNG search proxy, page fetch, Chromium/headless browser automation) was heavy and complex. The repo had no Chromium or headless-browser automation server-side; Playwright stays as the desktop UI test runner only.

The SearXNG search proxy and page fetch (`/v1/search`, `/v1/fetch`, `pages.py`, `ssrf.py`, `sanitize.py`, trafilatura, the `searxng` container) are removed. `app/injection.py` is kept because `services/packs/build_pack.py` imports it.

## Decision

`services/api` exposes `POST /api/v1/chat` (code in `app/gateway/`). The gateway implements a complete request lifecycle with authentication, context engineering, dynamic pricing, pre-flight safety checks, and post-flight billing.

### Request Flow

1. **Auth:** The existing access JWT; `uid` must be a real user row. That user ID scopes everything below. It is logged; prompt text is not. Returns 401 if invalid.

2. **Context:** The backend is the source of truth. History is read from `chat_messages WHERE user_id = …` only. The payload is one system message, the newest turns that fit `GATEWAY_HISTORY_TOKENS` (oldest dropped first, never starting on an assistant turn), then the new prompt. This ensures 100% tenant isolation with zero cross-contamination.

3. **Prices:** `models_pricing(model_id PK, input_price_per_million, output_price_per_million, context_window)`. They are upserted from `GET https://openrouter.ai/api/v1/models` every 6 hours (`PRICING_SYNC_SECONDS`). OpenRouter quotes USD per token, so the sync multiplies by 1,000,000. Routers priced `-1` are skipped.

4. **Pre-flight:**
   - Count tokens locally with tiktoken `cl100k_base` and multiply by 1.15 (15% safety buffer).
   - If the balance is below buffered tokens × input price, return 402 without calling OpenRouter.
   - Otherwise `max_tokens = floor((balance − input cost) / (output price / 1M))`, capped by the context window, and injected into the payload.
   - Streaming relays SSE and stops once the local completion count reaches that limit.

5. **Post-flight:**
   - raw = prompt × in/1M + completion × out/1M, using OpenRouter's native `usage`.
   - Deduction = raw × `GATEWAY_MARKUP` (1.20).
   - The balance update runs under `SELECT … FOR UPDATE`. A balance ≤ 0 sets `billing_locked`.
   - A `billing_transactions` audit row and the user/assistant turn are written in the same transaction.

### Database Schema

```sql
-- Model pricing from OpenRouter
CREATE TABLE models_pricing (
  model_id TEXT PRIMARY KEY,
  input_price_per_million NUMERIC(24,12) NOT NULL,
  output_price_per_million NUMERIC(24,12) NOT NULL,
  context_window INT NOT NULL,
  last_synced TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user gateway account with balance
CREATE TABLE gateway_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance NUMERIC(24,12) NOT NULL DEFAULT 0.0,
  billing_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chat history per user
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  model_id TEXT,
  tokens_used INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Billing audit trail
CREATE TABLE billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  raw_cost NUMERIC(24,12) NOT NULL,
  markup_multiplier NUMERIC(4,2) NOT NULL,
  final_deduction NUMERIC(24,12) NOT NULL,
  balance_before NUMERIC(24,12) NOT NULL,
  balance_after NUMERIC(24,12) NOT NULL,
  response_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Money is `Decimal` in Python and `numeric(24,12)` in Postgres.

### Configuration

Environment variables:
- `OPENROUTER_API_KEY` — Master API key (required)
- `OPENROUTER_BASE_URL` — OpenRouter API base URL (default: `https://openrouter.ai/api/v1`)
- `GATEWAY_MARKUP` — Final deduction = raw cost × markup (default: `1.20`)
- `GATEWAY_HISTORY_TOKENS` — Token budget for chat history (default: `2000`)
- `GATEWAY_STARTING_CREDIT` — Credit given to new accounts in USD (default: `0`)
- `GATEWAY_SYSTEM_PROMPT` — System prompt for chat (default: `You are a helpful assistant.`)
- `PRICING_SYNC_SECONDS` — Price sync interval in seconds (default: `21600` = 6 hours)
- `CHAT_PER_MIN` — Rate limit: chats per minute (default: `20`)
- `CHAT_PER_DAY` — Rate limit: chats per day (default: `500`)

## Consequences

### Positive

- **Lightweight:** No Chromium, no headless browser automation, no SearXNG container.
- **Secure:** Master API key never exposed to clients. Per-user billing prevents abuse.
- **Scalable:** Stateless token management. Backend is the source of truth.
- **Transparent:** Complete audit trail of all billing transactions.
- **Flexible:** Dynamic pricing sync ensures rates are always current.
- **Safe:** Pre-flight checks prevent overspend. 15% safety buffer absorbs tokenizer discrepancies.

### Negative

- **Privacy:** This reverses "prompts never leave the device" for the cloud chat path. `PRIVACY.md` and the project rule now say so.
- **Pre-flight limitation:** The pre-flight does not include the markup. A response that uses the full `max_tokens` can leave the balance slightly negative, and the lock flag then stops further use.
- **No top-ups:** Top-ups and admin balance endpoints are not part of this change. New accounts start at `GATEWAY_STARTING_CREDIT` (default 0).
- **Desktop compatibility:** The desktop's dev web search still calls the removed routes and will get 404 until it is removed or pointed at the gateway.

## Testing

Comprehensive tests in `tests/test_gateway.py` cover:

1. **Auth:** Unauthenticated requests rejected with 401. Valid tokens extract user ID.
2. **Context isolation:** Concurrent requests from user_A (3 messages) and user_B (0 messages) prove zero cross-contamination.
3. **Pricing sync:** Mock OpenRouter response with modified pricing updates without duplicates.
4. **Pre-flight:** $0.01 balance with large input returns 402. Short prompt gets restricted `max_tokens`.
5. **Billing:** Exact calculation: 5000 input + 2000 output @ $1/$2 per 1M = $0.009 raw, $0.0108 with 1.20x markup. Balance updates from $2.00 to $1.9892.
6. **Integration:** Complete flow from auth to billing.

## Migration

Alembic migration `0005_openrouter_gateway.py` creates the schema. Run:

```bash
cd services/api
alembic upgrade head
```

## References

- OpenRouter API: https://openrouter.ai/docs
- tiktoken: https://github.com/openai/tiktoken
- Related: ADR 0001 (product name), ADR 0002 (general chat), ADR 0003 (on-device dictation)
