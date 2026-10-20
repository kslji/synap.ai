"""Local token counting with tiktoken."""
from __future__ import annotations

import logging

log = logging.getLogger("surf.gateway.tokenizer")

# Try to import tiktoken, fall back to rough estimate if unavailable
try:
    import tiktoken
    _encoder = tiktoken.get_encoding("cl100k_base")
    TIKTOKEN_AVAILABLE = True
except ImportError:
    log.warning("tiktoken not available; using rough token estimate (1 token ≈ 4 chars)")
    TIKTOKEN_AVAILABLE = False


def count_tokens(text: str) -> int:
    """Count tokens in text using tiktoken or rough estimate.
    
    Args:
        text: The text to count tokens for
        
    Returns:
        Estimated token count
    """
    if not text:
        return 0
    
    if TIKTOKEN_AVAILABLE:
        return len(_encoder.encode(text))
    else:
        # Rough estimate: 1 token ≈ 4 characters
        return len(text) // 4


def count_messages_tokens(messages: list[dict[str, str]]) -> int:
    """Count total tokens across a list of chat messages.
    
    Args:
        messages: List of {"role": ..., "content": ...} dicts
        
    Returns:
        Total token count
    """
    total = 0
    for msg in messages:
        # Add overhead for message formatting (role, etc.)
        total += 4  # overhead per message
        total += count_tokens(msg.get("content", ""))
    return total
