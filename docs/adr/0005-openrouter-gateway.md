# ADR 0005 — OpenRouter chat gateway with per-user micro-billing

Many users share one master OpenRouter key, so the backend must meter each user's spend and never let the master account go negative. The SearXNG search proxy and page fetch (`/v1/search`, `/v1/fetch`, `pages.py`, `ssrf.py`, `sanitize.py`, trafilatura, the `searxng` container) are removed. The repo had no Chromium or headless-browser automation server-side. Playwright stays as the desktop UI test runner.

Decision: `services/api` exposes `POST /api/v1/chat` (code in `app/gateway/`).

1. **Auth:** the existing access JWT; `uid` must be a real user row. That user id scopes everything below. It is logged; prompt text is not.
2. **Context:** the backend is the source of truth. History is read from `chat_messages WHERE user_id = …` only. The payload is one system message, the newest turns that fit `GATEWAY_HISTORY_TOKENS` (oldest dropped first, never starting on an assistant turn), then the new prompt.
3. **Prices:** `models_pricing(model_id PK, input_price_per_million, output_price_per_million, context_window)`. They are upserted from `GET https://openrouter.ai/api/v1/models` every 6 h (`PRICING_SYNC_SECONDS`). OpenRouter quotes USD per token, so the sync multiplies by 1,000,000. Routers priced `-1` are skipped.
4. **Pre-flight:**
   - Count tokens locally with tiktoken `cl100k_base` and multiply by 1.15. If the balance is below buffered tokens × input price, return 402 without calling OpenRouter.
   - Otherwise `max_tokens = floor((balance − input cost) / (output price / 1M))`, capped by the context window, and injected into the payload.
   - Streaming relays SSE and stops once the local completion count reaches that limit.
5. **Post-flight:**
   - raw = prompt × in/1M + completion × out/1M, using OpenRouter's native `usage`. Deduction = raw × `GATEWAY_MARKUP` (1.20).
   - The balance update runs under `SELECT … FOR UPDATE`. A balance ≤ 0 sets `billing_locked`.
   - A `billing_transactions` audit row and the user/assistant turn are written in the same transaction.

Money is `Decimal` in Python and `numeric(24,12)` in Postgres.

Known gaps:
- The pre-flight does not include the markup, per the brief. A response that uses the full `max_tokens` can leave the balance slightly negative, and the lock flag then stops further use.
- Top-ups and admin balance endpoints are not part of this change. New accounts start at `GATEWAY_STARTING_CREDIT` (default 0).
- The desktop's dev web search still calls the removed routes and will get 404 until it is removed or pointed at the gateway.

Privacy: this reverses "prompts never leave the device" for the cloud chat path. `PRIVACY.md` and the project rule now say so.
