# Development Roadmap: Post-Gateway Implementation

## ✅ Phase 1 Complete: OpenRouter Gateway (Merged)

**PR #38** - OpenRouter chat gateway with per-user micro-billing

### What's Done
- ✅ `POST /api/v1/chat` endpoint with streaming support
- ✅ Per-user billing with Decimal precision
- ✅ Pre-flight token counting and safety checks
- ✅ Dynamic pricing sync from OpenRouter (every 6 hours)
- ✅ Complete audit trail in `billing_transactions`
- ✅ 13 comprehensive tests (all passing)
- ✅ Full documentation (ADR 0005, README, implementation guide)
- ✅ Database migration (0005_openrouter_gateway.py)

### Key Files
- `services/api/app/gateway/` - 8 Python modules
- `services/api/tests/test_gateway.py` - 450 lines of tests
- `docs/adr/0005-openrouter-gateway.md` - Architecture decision
- `OPENROUTER_GATEWAY_IMPLEMENTATION.md` - Implementation guide

---

## 🚀 Phase 2: Desktop App Migration (Next Priority)

### Goal
Update the desktop app to use the new `/api/v1/chat` endpoint instead of the old `/v1/search` and `/v1/fetch` endpoints.

### Tasks

#### 2.1 Update Web Client (`apps/desktop/src/main/core/web-client.ts`)

**Current State:**
```typescript
export async function searchWeb(opts: WebCall & { query: string; k?: number }): Promise<SearchResult[]> {
  const res = await call('/v1/search', opts, { method: 'POST', body: JSON.stringify(searchBody(opts.query, opts.k ?? 5)) })
  // ...
}

export async function fetchPages(opts: WebCall & { urls: string[] }): Promise<{ chunks: FetchedChunk[]; ... }> {
  const res = await call('/v1/fetch', opts, { method: 'POST', body: JSON.stringify({ urls: opts.urls.slice(0, 5) }) })
  // ...
}
```

**Target State:**
```typescript
export async function chat(opts: WebCall & { prompt: string; model?: string; stream?: boolean }): Promise<ChatResponse> {
  const res = await call('/api/v1/chat', opts, { 
    method: 'POST', 
    body: JSON.stringify({ 
      prompt: opts.prompt, 
      model: opts.model || 'openrouter/auto',
      stream: opts.stream || false 
    }) 
  })
  if (!res.ok) throw new WebClientError('chat failed', res.status)
  return res.json()
}

export async function getBalance(opts: WebCall): Promise<{ balance: string }> {
  const res = await call('/api/v1/balance', opts)
  if (!res.ok) throw new WebClientError('balance check failed', res.status)
  return res.json()
}
```

#### 2.2 Update Chat Route (`apps/desktop/src/main/core/chat-route.ts`)

**Current State:**
- Routes queries to `web` intent
- Calls `searchWeb()` and `fetchPages()`
- Composes results for model

**Target State:**
- Route all queries to `POST /api/v1/chat`
- Handle streaming responses
- Display billing info in UI

#### 2.3 Update IPC Contract (`apps/desktop/src/shared/ipc-contract.ts`)

**Add new methods:**
```typescript
export interface IpcApi {
  // ... existing methods
  chat(prompt: string, model?: string, stream?: boolean): Promise<ChatResponse>
  getBalance(): Promise<{ balance: string }>
}
```

#### 2.4 Update UI Components

**ChatScreen.tsx:**
- Add streaming response display
- Show token usage and cost
- Display remaining balance

**SettingsScreen.tsx:**
- Add "Billing" section
- Show current balance
- Add "Top Up" button (links to payment page)

### Testing
- [ ] Unit tests for new web-client methods
- [ ] Integration tests for chat flow
- [ ] E2E tests for streaming responses
- [ ] Manual testing of billing accuracy

### Estimated Effort
- **Time:** 2-3 days
- **Complexity:** Medium
- **Risk:** Low (additive changes, no breaking changes)

---

## 🧹 Phase 3: Remove Old Search Infrastructure

### Goal
Remove SearXNG and old search endpoints after desktop app is fully migrated.

### Tasks

#### 3.1 Update API (`services/api/app/main.py`)

**Remove:**
- `from .pages import fetch_one` (line 32)
- `from .ssrf import SsrfBlocked` (line 33)
- `search_gate()` function (line 154)
- `allow_hosts()` function (line 163)
- `SearchIn` model class
- `@app.post("/v1/search")` endpoint (line 401)
- `filter_domains()` function
- `cache_key()` function
- `read_cache()` / `write_cache()` functions
- `remember()` function
- `host_of()` function
- `FetchIn` model class
- `@app.post("/v1/fetch")` endpoint (line 667)

**Update:**
- Docstring (line 1)
- Health endpoint to remove SearXNG check (line 185-189)

#### 3.2 Delete Files

```bash
rm services/api/app/pages.py
rm services/api/app/ssrf.py
rm services/api/app/sanitize.py
rm -rf deploy/searxng
```

#### 3.3 Update Requirements

**`services/api/requirements.txt`:**
```diff
- trafilatura==2.0.0
```

#### 3.4 Update Docker Compose

**`deploy/docker-compose.yml`:**
```diff
- searxng:
-   image: searxng/searxng:latest
-   ports:
-     - "8080:8080"
-   volumes:
-     - ./searxng:/etc/searxng
-   environment:
-     - SEARXNG_SECRET=${SEARXNG_SECRET}
-   restart: unless-stopped
```

**`deploy/docker-compose.dev.yml`:**
```diff
- SEARXNG_URL: ${SEARXNG_URL:-http://searxng:8080}
```

#### 3.5 Update Environment Files

**`deploy/.env.example`:**
```diff
- SEARXNG_URL=http://searxng:8080
- SEARXNG_SECRET=change-me-in-production
- SEARCH_PER_MIN=10
- SEARCH_PER_DAY=100
- SEARCH_CACHE_TTL=600
- FETCH_ALLOW_HOSTS=
```

#### 3.6 Update Documentation

**`README.md` (root):**
- Remove "Web search on your laptop" section
- Add "OpenRouter Gateway" section

**`services/api/README.md`:**
- Update to reflect new gateway functionality
- Remove SearXNG references

**`docs/STEP-3.md`:**
- Update `npm run dev:search` to `npm run dev:api`

### Testing
- [ ] API tests pass without search endpoints
- [ ] Docker Compose validates
- [ ] No broken imports in main.py
- [ ] Desktop app still works (uses new gateway)

### Estimated Effort
- **Time:** 1 day
- **Complexity:** Medium (many files to update)
- **Risk:** Medium (breaking changes)

### Migration Strategy
1. ✅ Phase 2: Desktop app uses new gateway
2. ✅ Deploy Phase 2 to production
3. ✅ Monitor for 1 week
4. ✅ Phase 3: Remove old search
5. ✅ Deploy Phase 3 to production

---

## 💳 Phase 4: Payment Integration

### Goal
Allow users to top up their balance via Stripe/Razorpay.

### Tasks

#### 4.1 Add Payment Endpoints

**`services/api/app/gateway/router.py`:**
```python
@router.post("/api/v1/topup")
async def topup_balance(
    request: Request,
    amount: Decimal = Body(..., gt=0),
    payment_method: str = Body(..., pattern="^(stripe|razorpay)$"),
    user: dict = Depends(current_user),
):
    """Initiate a top-up payment."""
    # Create payment intent
    # Return payment URL
    pass

@router.post("/api/v1/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe payment completion."""
    # Verify webhook signature
    # Update user balance
    # Record in billing_transactions
    pass

@router.post("/api/v1/webhook/razorpay")
async def razorpay_webhook(request: Request):
    """Handle Razorpay payment completion."""
    # Verify webhook signature
    # Update user balance
    # Record in billing_transactions
    pass
```

#### 4.2 Update Store

**`services/api/app/gateway/store.py`:**
```python
async def add_balance(self, user_id: str, amount: Decimal, transaction_id: str) -> None:
    """Add balance after successful payment."""
    pass

async def get_transactions(self, user_id: str, limit: int = 50) -> list[dict]:
    """Get billing transaction history."""
    pass
```

#### 4.3 Update UI

**SettingsScreen.tsx:**
```typescript
const handleTopUp = async (amount: number) => {
  const response = await api.topupBalance(amount, 'stripe')
  window.open(response.payment_url, '_blank')
}
```

### Testing
- [ ] Payment flow works end-to-end
- [ ] Webhooks correctly update balance
- [ ] Transaction history is accurate
- [ ] Idempotency prevents double-charging

### Estimated Effort
- **Time:** 3-4 days
- **Complexity:** High (payment security, webhooks)
- **Risk:** High (money involved)

---

## 📊 Phase 5: Admin Dashboard

### Goal
Admin interface for managing users, viewing billing, and monitoring system health.

### Tasks

#### 5.1 Add Admin Endpoints

**`services/api/app/gateway/router.py`:**
```python
@router.get("/api/v1/admin/users")
async def list_users(
    request: Request,
    limit: int = 100,
    offset: int = 0,
    admin: dict = Depends(require_admin),
):
    """List all users with balances."""
    pass

@router.post("/api/v1/admin/users/{user_id}/balance")
async def adjust_balance(
    user_id: str,
    amount: Decimal = Body(...),
    reason: str = Body(...),
    admin: dict = Depends(require_admin),
):
    """Manually adjust user balance (for support)."""
    pass

@router.get("/api/v1/admin/billing/summary")
async def billing_summary(
    admin: dict = Depends(require_admin),
):
    """Get system-wide billing metrics."""
    pass
```

#### 5.2 Create Admin UI

**New screen: `AdminScreen.tsx`:**
- User list with balances
- Transaction history
- System health metrics
- Manual balance adjustment

### Testing
- [ ] Admin authentication works
- [ ] Balance adjustments are accurate
- [ ] Metrics are correct
- [ ] Audit trail is complete

### Estimated Effort
- **Time:** 3-4 days
- **Complexity:** Medium
- **Risk:** Low (read-only mostly)

---

## 📈 Phase 6: Analytics & Monitoring

### Goal
Track usage patterns, costs, and system health.

### Tasks

#### 6.1 Add Metrics Collection

**`services/api/app/gateway/service.py`:**
```python
async def record_metrics(self, user_id: str, model: str, tokens: dict, cost: Decimal):
    """Record usage metrics for analytics."""
    # Track: user, model, tokens, cost, timestamp
    pass
```

#### 6.2 Add Analytics Endpoints

**`services/api/app/gateway/router.py`:**
```python
@router.get("/api/v1/usage")
async def get_usage(
    request: Request,
    days: int = 30,
    user: dict = Depends(current_user),
):
    """Get user's usage statistics."""
    pass
```

#### 6.3 Create Dashboard

**New screen: `UsageScreen.tsx`:**
- Token usage over time
- Cost breakdown by model
- Balance history
- Usage forecasts

### Estimated Effort
- **Time:** 2-3 days
- **Complexity:** Medium
- **Risk:** Low

---

## 🎯 Priority Order

1. **Phase 2: Desktop App Migration** (Critical - users need to use new gateway)
2. **Phase 3: Remove Old Search** (Important - cleanup after migration)
3. **Phase 4: Payment Integration** (Important - monetization)
4. **Phase 5: Admin Dashboard** (Nice-to-have - operational efficiency)
5. **Phase 6: Analytics** (Nice-to-have - insights)

---

## 🚦 Current Status

- ✅ **Phase 1:** Complete (merged)
- 🚀 **Phase 2:** Ready to start
- ⏳ **Phase 3-6:** Planned

---

## 💡 Next Steps

**Immediate (This Week):**
1. Start Phase 2: Update desktop app to use new gateway
2. Test thoroughly in development
3. Create PR for Phase 2

**Short-term (Next Week):**
1. Merge Phase 2 PR
2. Monitor production for 1 week
3. Start Phase 3: Remove old search

**Medium-term (2-3 Weeks):**
1. Complete Phase 3
2. Start Phase 4: Payment integration
3. Test payment flow thoroughly

**Long-term (1-2 Months):**
1. Complete Phase 4
2. Build Phase 5: Admin dashboard
3. Add Phase 6: Analytics

---

## 📝 Notes

- Each phase should be a separate PR for easy review
- All phases should include comprehensive tests
- Documentation should be updated in each phase
- Consider backward compatibility during transitions
- Monitor production metrics after each deployment
