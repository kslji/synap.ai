"""Licence names for installed Python distributions. Unknown ones must be allowlisted."""
from __future__ import annotations

import json
import re
import sys
from importlib import metadata
from pathlib import Path

ALLOW = {
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "0BSD",
    "Python Software Foundation License",
    "PSF-2.0",
    "MIT License",
    "Apache Software License",
    "BSD License",
    "BSD",
    "MPL-2.0",
    "Historical Permission Notice and Disclaimer (HPND)",
    "HPND",
}
EXTRA = set(json.loads(Path("scripts/licence-allow.json").read_text(encoding="utf-8")).get("python") or [])
def requirement_names(paths: list[str]) -> set[str]:
    names: set[str] = set()
    for path in paths:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if not line or line.startswith("-"):
                continue
            name = re.split(r"[<>=\[]", line, maxsplit=1)[0].strip().lower().replace("_", "-")
            if name:
                names.add(name)
    changed = True
    while changed:
        changed = False
        for dist in metadata.distributions():
            current = (dist.metadata["Name"] or "").lower().replace("_", "-")
            if current not in names:
                continue
            for req in dist.requires or []:
                dep = re.split(r"[<>=\[]", req, maxsplit=1)[0].strip().lower().replace("_", "-")
                if dep and dep not in names:
                    names.add(dep)
                    changed = True
    return names


wanted = requirement_names(sys.argv[1:]) if len(sys.argv) > 1 else None
bad: list[str] = []
for dist in metadata.distributions():
    name = dist.metadata["Name"] or "unknown"
    if wanted is not None and name.lower().replace("_", "-") not in wanted:
        continue
    raw = dist.metadata.get("License-Expression") or dist.metadata.get("License") or ""
    licence = raw.splitlines()[0].strip() if raw.strip() else ""
    if not licence:
        classifiers = dist.metadata.get_all("Classifier") or []
        for row in classifiers:
            if row.startswith("License ::"):
                licence = row.split("::")[-1].strip()
                break
    if not licence:
        bad.append(f"{name}: missing")
        continue
    if name in EXTRA or licence in ALLOW or licence in EXTRA:
        continue
    # An OR expression is acceptable when one branch is already allowed.
    if " OR " in licence and " AND " not in licence:
        branches = [part.strip() for part in licence.split(" OR ")]
        if any(part in ALLOW or part in EXTRA or any(token in part for token in ("MIT", "Apache", "BSD", "ISC", "Python Software Foundation")) for part in branches):
            continue
    if any(token in licence for token in ("MIT", "Apache", "BSD", "ISC", "Python Software Foundation")):
        continue
    bad.append(f"{name}: {licence[:120]}")
if bad:
    print("\n".join(bad[:40]))
    sys.exit(1)
print(f"python licences ok")
