# OpenRouter API Gateway

A secure, lightweight, multi-tenant API gateway wrapper around the OpenRouter API with granular micro-billing for multiple users sharing a single master API key.

## Overview

This gateway replaces the heavy web-browsing infrastructure (SearXNG, Chromium, headless browsers) with a direct API proxy that enforces per-user billing and context isolation.

### Key Features

- **Multi-tenant isolation**: Each user's balance and billing are completely isolated (chat history stays on the device)
- **Micro-billing**: Granular per-token billing with configurable markup
- **Pre-flight safety**: Token counting and cost estimation before API calls
- **Dynamic pricing**: Automatic sync with OpenRouter's pricing every 6 hours
- **Audit trail**: Complete transaction history for billing reconciliation
- **Streaming support**: SSE streaming with automatic cutoff when balance is exhausted

## Architecture

```
┌─────────────┐
│   Client    │
│  (Desktop)  │
└──────┬──────┘
       │ JWT Token
       ▼
┌─────────────────────────────────────────┐
│         Gateway Router                  │
│    POST /api/v1/chat                    │
└──────┬──────────────────────────────────┘
       │
       ├─► Rate limit (per user + per IP, Valkey-backed → 429)
       │
       ├─► Auth (JWT validation → user_id)
       │
       ├─► Context Engineering
       │   └─► Build this turn's messages (history stays on the device)
       │
       ├─► Pre-Flight Gatekeeper
       │   ├─► Count tokens (tiktoken cl100k_base)
       │   ├─► Apply 15% safety buffer
       │   ├─► Calculate estimated cost
       │   ├─► Check balance ≥ cost → 402 if not
       │   └─► Calculate max_tokens = (balance - cost) / output_price
       │
       ├─► OpenRouter API Call
       │   └─► POST /chat/completions with master key
       │
       └─► Post-Flight Billing
           ├─► Extract native usage (prompt_tokens, completion_tokens)
           ├─► Calculate raw cost = (input × price/1M) + (output × price/1M)
           ├─► Apply markup (GATEWAY_MARKUP = 1.20)
           ├─► Deduct from balance (SELECT ... FOR UPDATE)
           ├─► Lock account if balance ≤ 0
           └─► Save audit transaction
```

## Installation

1. Add `tiktoken` to requirements:

```bash
cd services/api
pip install -r requirements.txt
```

2. Run database migration:

```bash
alembic upgrade head
```

3. Set environment variables:

```bash
export OPENROUTER_API_KEY="your-master-key-here"
export GATEWAY_STARTING_CREDIT="2.00"  # $2 for new accounts
export GATEWAY_MARKUP="1.20"           # 20% markup
```

## Usage

### Chat Endpoint

```bash
curl -X POST http://localhost:8000/api/v1/chat \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-3.5-sonnet",
    "prompt": "Hello, how are you?",
    "stream": false
  }'
```

### Response

```json
{
  "id": "chatcmpl-123",
  "model": "anthropic/claude-3.5-sonnet",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "I'm doing well, thank you!"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 8,
    "total_tokens": 18
  },
  "billing": {
    "transaction_id": "uuid-here",
    "input_tokens": 10,
    "output_tokens": 8,
    "raw_cost": 0.000034,
    "markup_multiplier": 1.20,
    "final_deduction": 0.0000408,
    "balance_before": 2.00,
    "balance_after": 1.9999592,
    "billing_locked": false
  }
}
```

### Streaming

```bash
curl -X POST http://localhost:8000/api/v1/chat \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-3.5-sonnet",
    "prompt": "Tell me a story",
    "stream": true
  }' \
  --no-buffer
```

The stream will automatically sever if the user runs out of balance mid-generation.

### Check Balance

```bash
curl http://localhost:8000/api/v1/balance \
  -H "Authorization: Bearer <jwt-token>"
```

Response:

```json
{
  "user_id": "uuid-here",
  "balance": 1.9999592,
  "billing_locked": false,
  "currency": "USD"
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | (required) | Master OpenRouter API key |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter API base URL |
| `GATEWAY_MARKUP` | `1.20` | Markup multiplier (1.20 = 20%) |
| `GATEWAY_STARTING_CREDIT` | `0` | Starting credit for new accounts (USD) |
| `GATEWAY_SYSTEM_PROMPT` | `You are a helpful assistant.` | Default system prompt |
| `PRICING_SYNC_SECONDS` | `21600` | Price sync interval (6 hours) |
| `CHAT_RATE_PER_MINUTE` | `30` | Chat requests per minute per user (429 over limit) |
| `CHAT_IP_RATE_PER_MINUTE` | `60` | Chat requests per minute per IP (429 over limit) |
| `OTP_RATE_PER_MINUTE` | `10` | OTP requests per minute per user (429 over limit) |
| `OTP_IP_RATE_PER_MINUTE` | `20` | OTP requests per minute per IP (429 over limit) |

## Database Schema

### models_pricing

Stores model pricing synced from OpenRouter.

| Column | Type | Description |
|--------|------|-------------|
| `model_id` | TEXT (PK) | Model identifier (e.g., `anthropic/claude-3.5-sonnet`) |
| `input_price_per_million` | NUMERIC(24,12) | Price per 1M input tokens (USD) |
| `output_price_per_million` | NUMERIC(24,12) | Price per 1M output tokens (USD) |
| `context_window` | INT | Model's context window size |
| `last_synced` | TIMESTAMPTZ | Last sync timestamp |

### gateway_accounts

Per-user account with balance.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID (PK) | User ID (FK to users table) |
| `balance` | NUMERIC(24,12) | Current balance (USD) |
| `billing_locked` | BOOLEAN | Account locked due to insufficient balance |
| `created_at` | TIMESTAMPTZ | Account creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### billing_transactions

Audit trail for all billing transactions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Transaction ID |
| `user_id` | UUID (FK) | User ID |
| `model_id` | TEXT | Model used |
| `input_tokens` | INT | Input tokens consumed |
| `output_tokens` | INT | Output tokens consumed |
| `raw_cost` | NUMERIC(24,12) | Raw cost from OpenRouter (USD) |
| `markup_multiplier` | NUMERIC(4,2) | Applied markup multiplier |
| `final_deduction` | NUMERIC(24,12) | Final deduction (USD) |
| `balance_before` | NUMERIC(24,12) | Balance before transaction |
| `balance_after` | NUMERIC(24,12) | Balance after transaction |
| `response_text` | TEXT | Model response (for audit) |
| `created_at` | TIMESTAMPTZ | Transaction timestamp |

## Testing

Run the comprehensive test suite:

```bash
cd services/api
pytest tests/test_gateway.py -v
```

### Test Coverage

- **Auth**: Unauthenticated requests rejected with 401
- **Context isolation**: Concurrent requests from different users have zero cross-contamination
- **Pricing sync**: Mock OpenRouter response updates pricing without duplicates
- **Pre-flight**: Insufficient balance returns 402, max_tokens calculated correctly
- **Billing**: Exact calculation verified (5000 input + 2000 output = $0.009 raw, $0.0108 with markup)
- **Integration**: Complete flow from auth to billing

## Security Considerations

1. **Master API key**: Never expose `OPENROUTER_API_KEY` to clients. The gateway is the only component that should have access.

2. **JWT validation**: All requests must include a valid JWT token. The `uid` claim is used to isolate user data.

3. **Balance checks**: Pre-flight checks prevent overspend. The 15% safety buffer absorbs tokenizer discrepancies.

4. **Rate limiting**: Chat and OTP routes are rate limited per user and per IP via Valkey (`CHAT_RATE_PER_MINUTE`, `CHAT_IP_RATE_PER_MINUTE`, `OTP_RATE_PER_MINUTE`, `OTP_IP_RATE_PER_MINUTE`); over the limit returns 429 with `Retry-After`.

5. **Audit trail**: All billing transactions are logged with full details for reconciliation.

6. **Account locking**: Accounts are automatically locked when balance reaches zero.

## Privacy

This gateway sends user prompts to OpenRouter for the cloud chat path, but **no chat history is stored server-side** — multi-turn history lives on the device (product rule). See `PRIVACY.md` and `docs/adr/0005-openrouter-gateway.md` for details.

## Known Limitations

1. **Pre-flight doesn't include markup**: The pre-flight check doesn't account for the markup multiplier. A response that uses the full `max_tokens` can leave the balance slightly negative. The account is then locked.

2. **No top-up mechanism**: There's no admin endpoint to add credit to user accounts yet. New accounts start at `GATEWAY_STARTING_CREDIT`.

3. **Desktop compatibility**: The desktop app's dev web search still calls the removed routes (`/v1/search`, `/v1/fetch`) and will get 404 errors.

## Future Enhancements

- Admin endpoints for balance management (top-up, adjust, refund)
- Webhook integration for payment processing (Stripe, Razorpay)
- Usage analytics dashboard
- Custom system prompts per user
- Model allowlist/denylist per user
- Budget alerts and notifications
- Automatic top-up when balance is low

## References

- [ADR 0005: OpenRouter Gateway](../../docs/adr/0005-openrouter-gateway.md)
- [OpenRouter API Documentation](https://openrouter.ai/docs)
- [tiktoken](https://github.com/openai/tiktoken)

## License

Same as the main project.
