---
kind: external_dependency
name: Supabase Auth (email OTP + Google)
slug: supabase-auth
category: external_dependency
category_hints:
    - auth_protocol
    - client_constraint
scope:
    - '**'
source_files:
    - docs/ARCHITECTURE-SHORT.md
    - docs/ARCHITECTURE-FULL.md
---

### Supabase Auth
- Role: identity provider for the marketing site and optional desktop sign-in flow; supports email OTP and Google social login via PKCE.
- Integration: referenced in architecture docs; the desktop signs in through the Surf API's own OTP flow rather than calling Supabase directly.
- Stable shape: free tier up to 50k MAU; self-hostable server available. The desktop's own auth is email-code based with device registration at login time.