# Surf ai - Small Cloud

Local-first copilot for the **YC × Moss Local-First AI / Small Cloud** track.

**License:** proprietary [Synap Developer License](LICENSE). Not open source.

The website is only a shell for the **local agent**. It does **not** store chats, prompts, vaults, or indexes.

## Chat

Open http://127.0.0.1:3000 and click **Open local agent**, or **Download for this device**.

The download is a zip (`local-agent.html` + `START.command` / `START.bat`). Unzip and run START. Python 3 serves the files on `http://127.0.0.1:18766` so WebGPU works. That path does **not** need Next.js or port 3000.

Do not double-click the HTML alone (`file://` is not a secure context).

Default engine: WebLLM in this browser (Chrome/Edge + WebGPU). Chats stay in that browser (IndexedDB).

Optional engines on **the user’s computer**, in the same window: **Ollama**, **Moss**, LiveKit. Attach them from the agent sidebar. They never run on local.ai servers.

WebGPU runs the model on this device’s GPU. It cannot read files, laptop/phone RAM, or other apps.

## Data model

**local.ai** is the global platform (the Next.js shell). It stores **0 bytes** of user data.

If the user attaches a local host, that data lives only on their machine:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/local.ai/instances/<id>/` |
| Linux | `~/.local/share/local.ai/instances/<id>/` |
| Windows | `%APPDATA%\local.ai\instances\<id>\` |

Inside each instance: `smallcloud.db`, vault keys, Moss index, JWT secret, traces.

The repo `data/` folder is not the product database. Leftover files there are migrated once into a user instance.

The local agent UI shows how much is stored in this browser (chats + retained memory) and, if the host is running, instance folder size via `GET /v1/storage`. **Keep summary** folds chats into a short note and deletes the chat text. **Erase data** deletes chats and that note from this browser. Both actions show a before/after count in the UI.

## What judges should see

| Mandatory | How we meet it |
|---|---|
| Moss | When the local host is attached, chats query `moss_runtime` (SDK session when keys exist; local session fallback otherwise). Never `push_index`. |
| Next.js | `apps/web` — `output: "export"` |
| LiveKit | Token from local host; client publishes mic to `ws://127.0.0.1:7880` |

## Resource budget (default)

- Browser engine: Llama 3.2 1B in-tab
- Optional Ollama: `llama3.2:3b` (~**2–2.5 GB RAM** while answering)
- Unload: `keep_alive=30s` (~**0.5 GB** when idle)
- Recommended machine: **8 GB RAM** minimum, **16 GB** comfortable

## Run locally

Terminal 1 — UI (enough for the default agent):

```bash
cd apps/web
npm install
npm run dev
```

Open http://127.0.0.1:3000 — click **Open local agent**.

Optional local engines (same agent window):

```bash
ollama serve
ollama pull llama3.2:3b
```

```bash
# https://docs.livekit.io/home/self-hosting/local/
livekit-server --dev
```

```bash
cd apps/host
# Need Python 3.12 or 3.13 — not 3.14 (pydantic-core cannot build on 3.14)
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# optional: export MOSS_PROJECT_ID=... MOSS_PROJECT_KEY=...
python -m uvicorn main:app --host 127.0.0.1 --port 18765
# concurrency (pick one — not both):
#   gunicorn -c gunicorn.conf.py main:app
#   python -m uvicorn main:app --host 127.0.0.1 --port 18765 --workers 4
# WEB_CONCURRENCY=4 gunicorn -c gunicorn.conf.py main:app
```

Harness:

```bash
./harness/run.sh
# or: python3 harness/evals/gate.py && python3 harness/evals/smoke.py
```

## Onboarding (in the local agent)

Attach engines from the sidebar: local host, Ollama, default model, LiveKit on :7880, Moss keys, optional master password.

- **Moss keys:** saved inside that user's local instance. Retrieval still never calls `push_index`.
- **Vault:** Argon2id + AES-256-GCM. If you skip it, a device key still encrypts traces/messages.
- **Dictation:** Chrome/Edge may send audio to the **browser vendor**. Transcripts then stay local.

## Host on a VM (`synap.surf`)

Point DNS **A** records for `synap.surf` and `www.synap.surf` at the VM. Nginx serves the static Next.js export and proxies `/v1` to Gunicorn on loopback. Chat engines stay on the user’s device; this host is the website plus auth/feedback.

On the VM (Ubuntu 22.04/24.04):

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx git build-essential python3.12 python3.12-venv nodejs npm

sudo mkdir -p /var/www/synap.surf /var/lib/synap/platform
sudo chown -R "$USER":"$USER" /var/www/synap.surf /var/lib/synap

git clone https://github.com/kslji/synap.ai.git ~/surf.ai
cd ~/surf.ai
cp .env.example .env
# edit .env: SMTP_*, CORS_ORIGINS, PLATFORM_DATA_DIR=/var/lib/synap/platform
nano .env

cd apps/web
npm ci
NEXT_PUBLIC_HOST_URL=https://synap.surf npm run build
rsync -a --delete out/ /var/www/synap.surf/

cd ~/surf.ai/apps/host
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Systemd unit `/etc/systemd/system/synap-host.service`:

```ini
[Unit]
Description=Synap FastAPI host
After=network.target

[Service]
WorkingDirectory=/home/YOUR_USER/surf.ai/apps/host
EnvironmentFile=/home/YOUR_USER/surf.ai/.env
Environment=PLATFORM_DATA_DIR=/var/lib/synap/platform
Environment=HOST_BIND=127.0.0.1:18765
Environment=CORS_ORIGINS=https://synap.surf,https://www.synap.surf
ExecStart=/home/YOUR_USER/surf.ai/apps/host/.venv/bin/gunicorn -c gunicorn.conf.py main:app
Restart=always
User=YOUR_USER

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now synap-host
```

Nginx site `/etc/nginx/sites-available/synap.surf` (HTTP first, then TLS):

```nginx
server {
    listen 80;
    server_name synap.surf www.synap.surf;
    root /var/www/synap.surf;
    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }
    location /v1/ {
        proxy_pass http://127.0.0.1:18765;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 180s;
        proxy_buffering off;
    }
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/synap.surf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d synap.surf -d www.synap.surf
```

Rebuild the web app whenever the API URL or UI changes: `NEXT_PUBLIC_HOST_URL=https://synap.surf` is baked in at `npm run build`.

Do **not** run Ollama or store chats on this VM. Users attach engines on their machine. `.env`, `*.db`, and `jwt.secret` stay off git.

## Hosting after the hackathon

You can also host **only** the Next.js `out/` folder (Vercel/GitHub Pages) as a landing/static shell, without the FastAPI auth host.

## Privacy

- Chat/RAG: on-device
- Website backend: none for user data
- LiveKit: loopback if you run `livekit-server --dev`
- WebGPU: GPU compute for this tab only — not a memory scanner

## Layout

```
apps/web     Next.js static local agent
apps/host    Optional FastAPI on the user's machine (Moss, Ollama proxy)
harness/     CRISPE prompt, evals, traces
```
