#!/usr/bin/env python3
"""Pack-local guardrails (same rules as Surf host). No network, no model."""

from __future__ import annotations

import re

INJECTION = re.compile(
    r"(ignore|disregard|forget)\s+(all|any|previous|prior|above|earlier)\s+(instructions|prompts|rules)|"
    r"system prompt override|"
    r"exfiltrate|"
    r"reveal (your|the) (system )?prompt|"
    r"you are now (dan|jailbroken)|"
    r"jailbreak this",
    re.I,
)
PII_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
OPENAI_KEY = re.compile(r"\bsk-[A-Za-z0-9]{10,}\b")
AWS_KEY = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
GITHUB_TOKEN = re.compile(r"\bghp_[A-Za-z0-9]{20,}\b")
PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")


def sanitize_user_text(text: str) -> tuple[str, list[str]]:
    flags: list[str] = []
    cleaned = (text or "").strip()
    if INJECTION.search(cleaned):
        flags.append("prompt_injection_pattern")
        cleaned = INJECTION.sub("[blocked-instruction]", cleaned)
    if PII_SSN.search(cleaned):
        flags.append("pii_ssn_redacted")
        cleaned = PII_SSN.sub("[redacted]", cleaned)
    if OPENAI_KEY.search(cleaned):
        flags.append("secret_api_key_redacted")
        cleaned = OPENAI_KEY.sub("[redacted-key]", cleaned)
    if AWS_KEY.search(cleaned):
        flags.append("secret_aws_key_redacted")
        cleaned = AWS_KEY.sub("[redacted-key]", cleaned)
    if GITHUB_TOKEN.search(cleaned):
        flags.append("secret_github_token_redacted")
        cleaned = GITHUB_TOKEN.sub("[redacted-key]", cleaned)
    if PRIVATE_KEY.search(cleaned):
        flags.append("secret_private_key_redacted")
        cleaned = PRIVATE_KEY.sub("[redacted-private-key]", cleaned)
    return cleaned, flags
