# Step 4 — Login, devices, and signed knowledge packs

Day 5 of the plan, with one change from `docs/IMPLEMENTATION.md`: the desktop signs in with email OTP on `services/api`. It does not use Supabase, and it does not call `apps/host`.

## Why the host is not the desktop auth server

`apps/host` is the existing OTP, account, and feedback API. Step 1 left it running and kept the new app off it. Its JWTs use a different audience (`local-ai`) and issuer, and its store is SQLite. The desktop search calls already check `Authorization: Bearer`, audience `authenticated`, and HS256.

The shared piece is the OTP policy. `services/api/app/otp_policy.py` hashes the 6-digit code with argon2, keeps it for 10 minutes, allows 5 attempts, and consumes it once. `apps/host/accounts.py` imports `hash_code` and `judge_otp` from that module so the two services do not drift. The host keeps its own HTTP messages, SQLite rows, and rate windows. The API adds a 60 second resend cooldown and stores users, devices, and refresh tokens in Postgres (memory when `SURF_API_LITE=1`).

## Login and devices

`POST /v1/auth/otp/start` always returns `{ "ok": true }` for a valid email, except `429 resend_cooldown`. `MAIL_MODE=console` (the lite default) prints `[surf-mail]` and includes `dev_code` in the JSON. `MAIL_MODE=smtp` sends through `SMTP_HOST` and does not return the code. Resend's free tier is `smtp.resend.com`.

`POST /v1/auth/otp/verify` creates the user on first success, activates a device, and returns a 15 minute access JWT plus a refresh token. The access token `sub` is `devices.id`, so the search rate limit stays per device. Extra claims are `uid` and `email`. `typ` must be `access`.

Refresh tokens are opaque, stored as SHA-256, and rotate on `POST /v1/auth/refresh`. Presenting a revoked token revokes the whole family (`refresh_reused`).

`POST /v1/devices/register` returns 410. A device row stores name and OS (`macos`, `windows`, or `linux`). The free plan allows 3 devices (`plans.features.max_devices`). Lite mode uses `MAX_DEVICES` (default 3). Revoking a device revokes its refresh tokens, and the next search with that access token is 401. A revoked device cannot sign in again on the same device id.

Alembic revision `0002_otp` creates `otp_challenges` and defaults `users.id` to `gen_random_uuid()`. `ensure_schema()` does the same on an existing volume. Fresh databases also get the table from `deploy/initdb/01_schema.sql`.

## Desktop session

Sign-in is one screen: email, then the 6-digit code. Tokens are encrypted with Electron `safeStorage` (`session.enc`). macOS uses the Keychain and Windows uses DPAPI. Linux uses libsecret when it is installed; otherwise Electron's `basic_text` fallback. The chat database key still refuses `basic_text`. Session tokens may use it, and a copy stays in memory for the launch.

The app chats and searches local documents with no account and with Offline only on. Sign-in is required for web search and pack sync. A silent refresh runs when the access token expires within 60 seconds.

## Knowledge packs

A pack directory holds `manifest.json`, `manifest.sig` (64-byte Ed25519 over the exact manifest bytes), and `pack.sqlite`. The manifest lists each file's sha256 and size, `min_app_version`, and the embedding spec. Vectors are EmbeddingGemma 2 truncated to 256 dimensions, the same prefixes the desktop uses.

The app verifies the signature against `resources/pack-keys.json` (plus `SURF_PACK_PUBKEY=id:hex` for a local key) and then every file hash. Install moves a staging directory to `version.incoming`, then to `version`. If that rename fails, the previous version is restored and `installed.json` is left unchanged.

`GET /v1/packs` lists the latest version, whether an update exists, and `changed_files` (sha256 diff, including the manifest and signature). `delta` is null; zstd pack deltas are not built yet. Download URLs are HMAC-SHA256 links to `GET /v1/packs/download` for `PACK_BACKEND=file`, or presigned R2/S3 URLs when `PACK_BACKEND=s3`.

```bash
python3 -m pip install -r services/packs/requirements.txt
python3 services/packs/build_pack.py \
  --src services/packs/general-starter \
  --out /tmp/packs/general-starter/2026.10.09 \
  --embed-url http://127.0.0.1:8081/v1/embeddings
```

`services/packs/general-starter/harbor-lantern.txt` is the demo source. The private signing seed is `PACK_SIGNING_KEY_HEX` or `--key-hex`. It is not in git.

When the desktop is online and signed in, it checks the catalog on launch and every `packSyncHours` (default 6). It downloads only changed files, resumes with HTTP Range, pauses when Offline only is on, the network is down, the link is metered (`nmcli`), or a chat is in progress. Installed packs join the hybrid search. A pack citation shows the pack name, version, and source title.

## Saved web passages

When an answer cites a web passage, Surf stores only that passage in the encrypted local database: url, title, domain, fetched time, published date when the page has one, and the EmbeddingGemma 2 vector (256 dimensions). The rows are `web_passages`, `web_passage_links`, an FTS5 table, and a sqlite-vec table. They are not uploaded. Search requests stay `{ query, k }`.

A later question searches those passages the same way it searches documents. The default scope is the current chat. **All chats** also searches saved web passages from other chats. Offline, or with web search off, a strong match stays local and is cited as `Web, saved <date>`. A question about prices or news that uses a passage older than 24 hours also shows: "Saved more than 24 hours ago. Prices and news may have changed."

The same url and passage text is stored once. Deleting a chat deletes its links, and a passage that no chat still cites is removed. Settings shows the stored size and can clear every saved web source. The cap is 8 MB of passage text; the least recently used passages are dropped first.

## Signing key

Generate a seed and keep it in a secret manager or an environment variable. Do not commit it, do not put it in an image, and do not paste it into a workflow log.

```bash
python3 - <<'PY'
from nacl.signing import SigningKey
key = SigningKey.generate()
print("PACK_SIGNING_KEY_HEX=" + key.encode().hex())
print("public " + key.verify_key.encode().hex())
PY
```

Put only the public hex in `apps/desktop/resources/pack-keys.json` under a key id such as `k2026a`. The copy in git is a verify key whose seed was not retained. Replace it before you publish a pack. `SURF_PACK_PUBKEY=k2026a:<64 hex chars>` overrides or adds a key for a local build.

The key already in `pack-keys.json` cannot verify packs you sign with a new seed. Ship the matching public key in the app build, and keep the seed in the secret store the pack builder reads.

## Cloudflare R2

R2's free tier includes egress, which is the reason pack files live there instead of on the GCP disk.

1. Create a bucket, for example `surf-packs`.
2. Create an API token that can read objects.
3. On the VM, set `PACK_BACKEND=s3`, `R2_BUCKET`, `R2_ENDPOINT` (`https://<accountid>.r2.cloudflarestorage.com`), `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.
4. Upload `general-starter/2026.10.09/manifest.json`, `manifest.sig`, and `pack.sqlite` under those keys. The catalog presigns for 15 minutes. `boto3` is imported only when `PACK_BACKEND=s3`; the API image does not install it until you add it to `services/api/requirements.txt` for a real bucket.

`PACK_BACKEND=file` and `PACK_ROOT` are the dev and self-test path. Leave the bucket empty until you are ready to publish.

## GCP

The compose file is unchanged aside from new variables in `deploy/.env`. On the VM:

```bash
cd /opt/surf
# edit deploy/.env — JWT_SECRET, MAIL_MODE, SMTP_*, PACK_BACKEND, R2_*
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build api
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec api python -m alembic upgrade head
```

`ensure_schema()` also creates `otp_challenges` on boot, so an existing volume does not need a manual table for login to work. `alembic upgrade head` is the recorded migration. Postgres init scripts run only on a new volume.

## Environment

| Variable | Role |
|---|---|
| `JWT_SECRET` | HS256 access tokens and file download HMACs |
| `JWT_AUDIENCE` | Stays `authenticated` |
| `MAIL_MODE` | `console` or `smtp` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Used when `MAIL_MODE=smtp` |
| `MAX_DEVICES` | Lite-mode device cap. Postgres uses the plan row |
| `PACK_BACKEND` | `file` or `s3` |
| `PACK_ROOT` | Directory of `id/version/` packs for the file backend |
| `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Presigned downloads |
| `PACK_SIGNING_KEY_HEX` | 32-byte Ed25519 seed for `build_pack.py` only. Never commit it |
| `SURF_PACK_PUBKEY` | Optional `keyId:hex` added to the desktop trust set |
| `SURF_API_BASE` | Desktop override for the API origin |

## Checks

```bash
cd services/api && python3 -m pytest && python3 -m alembic heads
cd apps/desktop && npm run test:unit
```

The desktop self-test signs in with the dev OTP, builds the general starter pack against the local embed server, downloads it from the lite API, verifies the signature, and asks for the lantern code online and again after that API is stopped. The web step answers from the live fixture, turns Offline only on, and answers a follow-up from the saved passage with a `Web, saved <date>` citation.
