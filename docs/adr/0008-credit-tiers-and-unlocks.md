# ADR 0008 — Credit tiers and model unlocks for Online Cloud

## Status

Accepted. Extends [ADR 0005](0005-openrouter-gateway.md) (the OpenRouter gateway
and micro-billing). This ADR adds a *purchase-tier access* layer on top of the
existing *balance affordability* layer; it changes neither the markup nor the
per-turn pre-flight.

## Context

Surf ships two chat modes and no automatic routing: **Offline Mode (Air-Gapped)**
(the local model, no egress, no cost to the user) and **Online Cloud** (the gateway).
Offline is free and always available, so Online Cloud is the only thing that
consumes money, and only a small fraction of turns route there.

The gateway today gives **every** new account `$2` of spend
(`GATEWAY_STARTING_CREDIT`) and exposes a flat allowlist of expensive frontier
models. Three problems follow:

1. Claude Opus-class models cost ~$0.86 for a *single* IDE turn, so one accidental
   selection burns the entire `$2` grant in two turns — and the trial never sees a
   bill, only a sudden 402.
2. There is no notion of "you must buy before you use", so the product cannot
   gate frontier cost behind a paid plan.
3. `GATEWAY_STARTING_CREDIT` is a dollar balance with no idea what it bought, so a
   signup grant and a real purchase are indistinguishable in audit.

We want: a **coarse, integer credit** the user reasons about; a **purchase tier**
that unlocks model families as they buy more; and a **signup grant small enough**
to taste Online Cloud on economy models but not to reach a frontier bill.

## Decision

### Unit — the credit, and what one is worth

- The internal ledger stays **exact USD** (`NUMERIC(24,12)`), and the settle-time
  markup stays **1.20×**. We do not re-denominate the balance.
- **1 credit = $0.40** of workload ≈ ~100 standard small-model turns. The credit is
  a fixed bundle of *expected* usage, not a live dollar→token conversion, so a 10%
  OpenRouter price move changes our margin, not what a user is allowed to run.
- Top-ups: `$2 = 5 credits`, `$10 = 25 credits`, `$20 = 50 credits`. (All exact
  multiples of $0.40; the price is held in credits even when raw cost drifts.)

### Signup grant — deliberately below the first paid tier

- `GATEWAY_STARTING_CREDIT = 0.40` — one trial credit, recorded in
  `gateway_accounts.signup_credit` so it is never mistaken for a purchase.
- `max_topup_credits` starts at **0** and only rises on a *real paid top-up*
  (Stripe or Razorpay). A trial user therefore has $0.40 of balance but no purchase
  tier, so they can only reach **Tier 0** economy models.

### Access vs affordability — two independent checks

- **Access (new):** a model is usable iff `gateway_accounts.max_topup_credits >=
  model_tiers.min_credits`. This is a *purchase tier* and it is **monotonic** —
  buying more never revokes a tier you already reached:
  `max_topup_credits = GREATEST(max_topup_credits, purchased_credits)`.
- **Affordability (unchanged):** the existing `preflight_check` still gates each
  turn on `balance >= estimated_cost` and clamps `max_tokens` to the remaining
  balance. A user can *hold* Tier 2 access and simply be out of spent balance.

Access answers "may this account pick this model"; affordability answers "can it
pay for this turn". Keeping them separate is what stops the surprise-bill failure
in the Context.

### Tiers

| Tier | `min_credits` | unlocked by | intent | models (OpenRouter ids) |
|-----:|--------------:|-------------|--------|-------------------------|
| 0 · Trial  | 0  | signup grant | fast economy, tastes Online Cloud free | `google/gemini-2.5-flash` |
| 1 · Daily  | 5  | $2 top-up    | balanced coding workhorses | `openai/gpt-5-mini`, `openai/gpt-4.1`, `anthropic/claude-sonnet-4.5`, `deepseek/deepseek-chat`, `qwen/qwen3-coder` |
| 2 · Frontier | 25 | $10 top-up   | heavy reasoning, highest cost | `openai/gpt-5`, `google/gemini-2.5-pro`, `x-ai/grok-4.5`, `openai/o3`, `anthropic/claude-opus-4.5` |

`model_allowlist.py` remains the single source of truth: each `AllowedModel` carries
`min_credits` + `tier_label`, and `model_tiers` is seeded from it at startup. There
is no second hand-maintained tier table.

### Locked response shape

A tier-gate rejection raises a typed `ModelLockedError` → HTTP **403**, body:

```json
{ "error": "model_locked", "model_id": "...", "required_credits": 5,
  "current_max_topup_credits": 0, "unlock_usd": 2.00 }
```

The IDE and desktop pickers render that as an "Unlock with $2 top-up" affordance
instead of failing silently mid-chat.

## Consequences

**Positive**
- A trial user can never reach a frontier bill: Opus-class is 403, not a $0.86
  surprise, and the $0.40 grant can't satisfy any `min_credits > 0` tier anyway.
- Credits are integer and stable across provider price moves; margin absorbs the
  volatility, UX doesn't.
- `credit_ledger` gives auditable top-up/spend/refund rows for GST/invoice and
  Stripe/Razorpay reconciliation, and distinguishes grant from purchase.

**Negative / costs**
- Two systems now describe money (USD ledger + integer credits). The conversion
  ($0.40/credit) is a product constant and must be documented everywhere it shows.
- Purchase tier is monotonic, so a refund cannot re-lock a model the user already
  earned; refunds only reduce *balance*. Accepted deliberately — access is loyalty,
  balance is affordability.
- `model_tiers` must be seeded for every allowlisted model or that model is treated
  as unpriced; a startup/sync guard fails loudly on any allowlisted model with no
  tier row and no pricing (this also catches the retired `x-ai/grok-4`).

**Superseded**
- ADR 0005's line "`app/injection.py` is kept because build_pack imports it" is now
  moot: web-search removal deleted that module and `build_pack.py` carries its own
  copy of the paragraph filter (reading the desktop `injection-rules.json`).
