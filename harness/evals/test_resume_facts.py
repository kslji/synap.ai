#!/usr/bin/env python3
"""Résumé must not be labeled YAML; company experience must answer from the file."""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST = HERE.parents[1] / "apps" / "web" / "src" / "lib" / "groundedContext.ts"


RESUME = """KABIR SINGH LAMBA
PROFESSIONAL SUMMARY
Software Engineer with 4 years of experience.
TECHNICAL SKILLS
Languages: Python, TypeScript
Databases: MongoDB, MySQL
Testing: Pytest
Practices: Agile
Technologies: Python, Django
Technologies: Python, PySpark
Certifications: AWS
PROFESSIONAL EXPERIENCE
 Senior Software Development Engineer (SDE-2), Park+
 Aug 2025 - Nov 2025
Gurugram, India
 Led architecture design for OMS migration.
"""


def looks_like_resume(name: str, raw: str) -> bool:
    if re.search(r"\.(ya?ml|toml|ini|env|conf|cfg)$", name, re.I):
        return False
    t = raw[:4000]
    hits = sum(
        1
        for re_ in [
            r"professional\s+experience",
            r"work\s+experience",
            r"education",
            r"technical\s+skills",
            r"curriculum\s+vitae|\bresume\b",
            r"\b(bachelor|master|b\.?tech|university)\b",
            r"\b(software|senior)?\s*(engineer|developer|sde)\b",
        ]
        if re.search(re_, t, re.I)
    )
    if re.search(r"\.pdf$", name, re.I) and hits >= 1:
        return True
    return hits >= 2


def yaml_heuristic_would_fire(raw: str) -> bool:
    """Old broken heuristic: any Label: line looked like YAML."""
    return bool(re.search(r"^[\w.-]+:\s", raw, re.M)) and not raw.strip().startswith("{")


def extract_park(blob: str) -> str | None:
    lines = blob.splitlines()
    hit = next((i for i, ln in enumerate(lines) if re.search(r"Park\+?", ln, re.I) and re.search(r"engineer|developer|sde|,", ln, re.I)), None)
    if hit is None:
        hit = next((i for i, ln in enumerate(lines) if re.search(r"Park\+?", ln, re.I)), None)
    if hit is None:
        return None
    window = "\n".join(lines[max(0, hit - 1) : hit + 6])
    date = re.search(
        r"\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\s*[-–—to]+\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|Present|Current|Now)",
        window,
        re.I,
    )
    role = lines[hit].strip()
    if date:
        return f"{role} · {date.group(1)} – {date.group(2)}"
    return role


def run_checks() -> list[dict]:
    rows: list[dict] = []
    src = HOST.read_text(encoding="utf-8") if HOST.exists() else ""
    rows.append(
        {
            "id": "source-has-resume-guard",
            "ok": "looksLikeResumeOrCv" in src and "extractCompanyExperience" in src and "extractiveTopicAnswer" in src,
            "detail": f"groundedContext.ts present={HOST.exists()}",
        }
    )
    rows.append(
        {
            "id": "resume-detected",
            "ok": looks_like_resume("Kabir_Singh_Lamba.pdf", RESUME),
            "detail": "pdf + professional experience",
        }
    )
    rows.append(
        {
            "id": "old-yaml-would-false-positive",
            "ok": yaml_heuristic_would_fire(RESUME),
            "detail": "documents that the old Label: heuristic still matches resumes (why we need the guard)",
        }
    )
    # With guard, we must NOT treat as YAML when resume-like
    treat_yaml = yaml_heuristic_would_fire(RESUME) and not looks_like_resume("Kabir_Singh_Lamba.pdf", RESUME)
    rows.append(
        {
            "id": "resume-not-yaml-with-guard",
            "ok": not treat_yaml,
            "detail": f"treat_yaml={treat_yaml}",
        }
    )
    park = extract_park(RESUME)
    rows.append(
        {
            "id": "park-experience-extract",
            "ok": bool(park) and "Park+" in (park or "") and "2025" in (park or ""),
            "detail": repr(park),
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
