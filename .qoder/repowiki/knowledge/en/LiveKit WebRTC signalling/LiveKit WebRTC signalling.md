---
kind: external_dependency
name: LiveKit WebRTC signalling
slug: livekit
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - apps/host/livekit_tokens.py
    - apps/host/livekit_probe.py
    - apps/host/requirements.txt
---

### LiveKit
- Role: WebRTC session management for the legacy host service; tokens are minted via `livekit.api.AccessToken` and reachability probed via the HTTP wrapper of the WebSocket URL.
- Integration: `apps/host/livekit_tokens.py` and `apps/host/livekit_probe.py`; configured through `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`.
- Stable shape: optional — if any of the three env vars is missing, token minting returns a not-configured response.