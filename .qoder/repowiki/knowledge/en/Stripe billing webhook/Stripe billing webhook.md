---
kind: external_dependency
name: Stripe billing webhook
slug: stripe
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

### Stripe
- Role: payment provider whose webhook events activate/renew licences and grant features to devices.
- Stable shape: HMAC signature verification against the Stripe header; requires `LICENCE_SIGNING_KEY_HEX` to issue device licences after purchase.