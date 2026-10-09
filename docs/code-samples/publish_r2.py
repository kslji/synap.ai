"""
Step 5: compress, make a delta against the previous version, upload to Cloudflare R2
(S3-compatible API) and record pack_files/pack_deltas rows. Untested against a live
bucket in this document's preparation — the boto3 + R2 endpoint pattern is the one
documented by Cloudflare (https://developers.cloudflare.com/r2/api/s3/api/).

pip install boto3   (and the `zstd` CLI, v1.5+)
"""
from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

import boto3

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name="auto",
)
BUCKET = os.environ.get("R2_PUBLIC_BUCKET", "harbor-public")


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def zstd_compress(src: Path) -> Path:
    dst = src.with_suffix(src.suffix + ".zst")
    # --long=31 lets zstd find matches across a 2 GB window (decompressor must pass --long=31 too)
    subprocess.run(["zstd", "-q", "-f", "-19", "--long=31", str(src), "-o", str(dst)], check=True)
    return dst


def zstd_delta(old: Path, new: Path, out: Path) -> Path:
    # byte-exact patch: client runs  zstd -d --long=31 --patch-from=old delta -o new
    subprocess.run(["zstd", "-q", "-f", "-19", "--long=31", f"--patch-from={old}",
                    str(new), "-o", str(out)], check=True)
    return out


def upload(path: Path, key: str, content_type: str = "application/octet-stream") -> None:
    s3.upload_file(str(path), BUCKET, key, ExtraArgs={"ContentType": content_type,
                                                      "CacheControl": "public, max-age=31536000, immutable"})


def publish(pack_dir: Path, pack_id: str, version: str, prev_dir: Path | None, prev_version: str | None):
    db = pack_dir / "pack.sqlite"
    zst = zstd_compress(db)
    upload(zst, f"packs/{pack_id}/{version}/pack.sqlite.zst")
    if prev_dir and prev_version:
        d = zstd_delta(prev_dir / "pack.sqlite", db, pack_dir / f"{prev_version}__{version}.zst")
        upload(d, f"packs/{pack_id}/deltas/{d.name}")
    # manifest last: clients only see a version once every file it references exists
    upload(pack_dir / "manifest.sig", f"packs/{pack_id}/{version}/manifest.sig")
    upload(pack_dir / "manifest.json", f"packs/{pack_id}/{version}/manifest.json", "application/json")
