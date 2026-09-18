from __future__ import annotations

from datetime import timedelta

from livekit.api import AccessToken, VideoGrants

from config import settings


def livekit_configured() -> bool:
    return bool(settings.livekit_api_key and settings.livekit_api_secret and settings.livekit_url)


def mint_livekit_token(identity: str) -> dict:
    if not livekit_configured():
        raise RuntimeError("LiveKit keys missing")
    token = (
        AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(identity)
        .with_name("local-ai-user")
        .with_grants(
            VideoGrants(
                room_join=True,
                room=settings.livekit_room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
    )
    if hasattr(token, "with_ttl"):
        token = token.with_ttl(timedelta(hours=2))
    jwt = token.to_jwt()
    return {
        "token": jwt,
        "url": settings.livekit_url,
        "room": settings.livekit_room,
    }
