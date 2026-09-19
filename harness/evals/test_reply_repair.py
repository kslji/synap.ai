#!/usr/bin/env python3
"""Light-model reply repair: soft-dedupe → extractive rescue → hard cap.

Mirrors apps/web/src/lib/groundedContext.ts repairLoopedReply so loops
(like repeated receipt bullets) cannot ship as the final answer.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def soft_fact_key(text: str, token_cap: int = 10) -> str:
    t = re.sub(r"\$[\d.]+", "$", text.lower())
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return " ".join(t.split()[:token_cap])


def collapse_duplicate_bullets(text: str) -> str:
    out: list[str] = []
    seen: set[str] = set()
    for line in text.split("\n"):
        m = re.match(r"^([-•*]|\d+[.)])\s+(.*)$", line.strip())
        if not m:
            out.append(line)
            continue
        key = soft_fact_key(m.group(2), 10)
        if len(key) > 12 and key in seen:
            continue
        if len(key) > 12:
            seen.add(key)
        out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def looks_like_looped_summary(text: str) -> bool:
    bullets = []
    for line in text.split("\n"):
        m = re.match(r"^([-•*]|\d+[.)])\s+(.*)$", line.strip())
        if not m:
            continue
        key = soft_fact_key(m.group(2), 8)
        if len(key) > 10:
            bullets.append(key)
    if len(bullets) < 4:
        return False
    counts: dict[str, int] = {}
    for k in bullets:
        counts[k] = counts.get(k, 0) + 1
    return max(counts.values()) >= 3 or len(counts) <= (len(bullets) + 1) // 2


def hard_cap_bullets(text: str, max_n: int = 8) -> str:
    out: list[str] = []
    n = 0
    for line in text.split("\n"):
        if re.match(r"^\s*([-•*]|\d+[.)])\s+", line):
            if n >= max_n:
                continue
            n += 1
        out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def repair_looped_reply(text: str) -> str:
    out = collapse_duplicate_bullets(text)
    if not looks_like_looped_summary(out):
        return out
    return hard_cap_bullets(collapse_duplicate_bullets(out), 8)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    looped = "\n".join(
        [
            "* PURCHASE PositiveSSL 1 year $5.88 : tracks the purchase of a PositiveSSL certificate for 1 year with a specific price.",
            "* PURCHASE PositiveSSL 1 month $5.88 : tracks the purchase of a PositiveSSL certificate for 1 month with a specific price.",
            "* PURCHASE PositiveSSL 1 year $5.88 : tracks the purchase of a PositiveSSL certificate for 1 year with a specific price.",
            "* PURCHASE PositiveSSL 1 month $5.88 : tracks the purchase of a PositiveSSL certificate for 1 month with a specific price.",
            "* PURCHASE PositiveSSL 1 year : tracks the purchase of a PositiveSSL certificate for 1 year.",
            "* PURCHASE PositiveSSL 1 month : tracks the purchase of a PositiveSSL certificate for 1 month.",
            "* PURCHASE PositiveSSL 1 year $5.88 : tracks the purchase of a PositiveSSL certificate for 1 year with a specific price.",
            "* PURCHASE PositiveSSL 1 month $5.88 : tracks the purchase of a PositiveSSL certificate for 1 month with a specific price.",
            "* PURCHASE PositiveSSL 1 year : tracks the purchase of a PositiveSSL certificate for 1 year.",
            "* PURCHASE PositiveSSL 1 month : tracks the purchase of a PositiveSSL certificate for 1 month.",
        ]
    )
    rows.append(
        {
            "id": "reply-loop-detected",
            "ok": looks_like_looped_summary(looped),
            "detail": "ten near-copy receipt bullets must flag as looped",
        }
    )
    fixed = repair_looped_reply(looped)
    bullet_n = sum(1 for ln in fixed.split("\n") if re.match(r"^([-•*]|\d+[.)])\s+", ln.strip()))
    rows.append(
        {
            "id": "reply-loop-collapsed",
            "ok": bullet_n <= 3 and not looks_like_looped_summary(fixed),
            "detail": f"bullets={bullet_n} still_looped={looks_like_looped_summary(fixed)} out={fixed!r}",
        }
    )
    clean = "* Domain synap.surf\n* PositiveSSL 1 year\n* Stellar hosting 1 month"
    rows.append(
        {
            "id": "reply-clean-unchanged",
            "ok": not looks_like_looped_summary(clean) and repair_looped_reply(clean) == clean,
            "detail": repair_looped_reply(clean),
        }
    )
    for row in rows:
        print(("PASS" if row["ok"] else "FAIL"), row["id"], str(row["detail"])[:160])
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
