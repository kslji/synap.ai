#!/usr/bin/env python3
"""Download the Qwen3.5-2B and EmbeddingGemma 2 GGUFs listed in the model registry."""
from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WANT = {"qwen3.5-2b-q4_k_m", "embeddinggemma-2-text-q8_0"}


def main() -> None:
    registry = json.loads((ROOT / "apps" / "desktop" / "resources" / "models.registry.json").read_text(encoding="utf-8"))
    dest = Path(os.environ.get("SURF_MODELS_DIR", Path.home() / "surf-models"))
    dest.mkdir(parents=True, exist_ok=True)
    for model in registry["models"]:
        if model["id"] not in WANT:
            continue
        path = dest / model["file"]
        if path.exists() and path.stat().st_size == model["size_bytes"]:
            print("have", path)
            continue
        print("download", model["file"])
        partial = path.with_suffix(path.suffix + ".part")
        urllib.request.urlretrieve(model["url"], partial)
        digest = hashlib.sha256(partial.read_bytes()).hexdigest()
        if digest != model["sha256"] or partial.stat().st_size != model["size_bytes"]:
            partial.unlink(missing_ok=True)
            raise SystemExit(f"hash mismatch for {model['file']}")
        partial.replace(path)
        print("ok", path)


if __name__ == "__main__":
    main()
