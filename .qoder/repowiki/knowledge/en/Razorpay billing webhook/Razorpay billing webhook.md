---
kind: external_dependency
name: Razorpay billing webhook
slug: razorpay
category: external_dependency
category_hints:
    - auth_protocol
scope:
    - '**'
source_files:
    - deploy/.env.example
    - services/api/app/main.py
    - services/api/app/licences.py
---

### Razorpay
- Role: alternative payment provider (India-focused) whose webhook events activate/renew licences identically to Stripe.
- Integration: endpoint `POST /v1/billing/razorpay`; signature verified via `verify_razorpay` using `RAZORPAY_WEBHOOK_SECRET`.
- Stable shape: same licence lifecycle as Stripe; both providers converge on `apply_webhook` with a `provider` discriminator.