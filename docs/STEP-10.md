# Step 10 — search on the laptop

Production web search runs on the computer that is asking. It does not call our API for search, and it does not ask for a search API key. The eval fixture still uses `POST /v1/search` when `SURF_SEARCH_FIXTURE=1`, so the existing beacon case stays on that path.

## What runs where

Local sources are tried in this order: knowledge pack, chat history, project index, disk cache, then the user's files. Online runs when those are thin, the question is fresh, or a live figure or statute is not already on the machine.

Online connectors, in code, by intent:

- Code: GitHub, Stack Exchange, npm, PyPI, crates.io, Hacker News Algolia.
- Papers: arXiv, Semantic Scholar, Hugging Face, Wikipedia.
- News and general: Hacker News and Wikipedia, as listed in `connectors.ts`.
- DuckDuckGo lite HTML is used only when those connectors return nothing. A failure there returns no links. It does not fail the answer.
- Reddit and X are not connectors. Result URLs on those hosts are dropped.

Pages are read on the laptop with Readability and Turndown. A hidden Electron window runs only when the static extract is shorter than 280 characters. That window is sandboxed. It was not exercised in a browser test. Caps: 1 MB of HTML, 8,000 characters of text, 8 seconds to fetch, 6 seconds for the hidden window. Tracker tags and known tracker hosts are stripped.

Disk cache lives in the encrypted user database (`search_disk_cache`). Search rows expire after 24 hours. Page text expires after 7 days. The cap is 32 MB. Storage shows "Search cache · searches 24h, pages 7 days" and can clear it separately from saved passages.

## Region

There is no default country.

1. A place named in the question wins.
2. A non-empty My region setting wins over the public IP, so a VPN exit does not pick the country.
3. Otherwise the app asks `https://api.ipify.org` for the public IP and looks it up in `resources/geo/dbip-country-lite.cidr` when that file is present.
4. If the file is missing, the IP is unknown, or the computer is offline, the label is worldwide sources.

The country file is not in the repo. `node scripts/fetch-dbip-country.mjs` in `apps/desktop` downloads DB-IP Lite (CC BY 4.0) and writes it. Answers that go through this router start with `Showing results for …`.

## Finance and legal

Live numbers come from the cited source. The model is not asked for the figure.

- SIP, XIRR, return, P&L, and the India equity tax table are calculated in `finance.ts`.
- The India equity rates are a bundled table dated 2024-07-23. They are not a live statute fetch. They are used only when the region is India or the question says India.
- Mutual-fund NAV is the AMFI daily file, and only when the region is India.
- Coin prices are the CoinGecko free API.
- SEBI and RBI items are their RSS feeds. If a feed fails, the answer says the figure is unavailable. It does not invent one.
- Stocks are end-of-day files from the NSE and BSE download URLs, and only when the region is India or the question names NSE, BSE, or India. Those downloads often fail from a datacenter. Failure is the designed result.
- Every finance answer includes the disclaimer that this is not a recommendation to buy or sell.

Legal answers quote a local document or an India Code search result and say "This is not legal advice." India Code is one provider. Another country is another entry in `LEGAL_PROVIDERS`. If the section is not in the sources, the answer says so and does not invent a section.

Web-derived answers keep an `[S1]` marker. Pack citations can include a pack version line. The fresh-info eval case is still `web-saved` (beacon `SB-4417`) on the fixture. Finance and legal eval cases are answered in code before the model.

## Pack deltas

`services/packs/build_delta.py` collects a sitemap, RSS, arXiv, or Hugging Face feed, writes a sqlite delta, encrypts it with NaCl SecretBox, and signs the manifest. The catalog's `delta` field is that `delta.sqlite.enc` file when the bundle contains one.

`--fixture-embed` uses a SHA-256 hash vector so tests do not need llama-server. That is not EmbeddingGemma. A real build passes `--embed-url` to a local llama-server. Keys are `PACK_SIGNING_KEY_HEX` and `PACK_CONTENT_KEY_HEX`. They are empty in `.env.example`.

Chat still opens plaintext `pack.sqlite` when that file is present. That path is unchanged.

When `delta.sqlite.enc` is in the installed folder, chat checks the manifest signature and the file hash again, then tries to decrypt the NaCl secretbox. Keys tried, in order: `SURF_PACK_CONTENT_KEY` (64 hex characters), then the licence-derived pack key. The builder's `PACK_CONTENT_KEY_HEX` is not in the app, so a normal install cannot open a delta sealed with that private key. A wrong key leaves the delta sealed and still uses `pack.sqlite` if it is there. A decrypted copy is written under the app's data folder, outside the signed directory. Delta search uses the float32 embedding blobs plus keyword overlap, because that file has no FTS5 or vec0 index.

## Not in this step

- No feedback table, feedback IPC, or thumbs control.
- No Reddit or X connector.
- The full DB-IP database is not bundled.
- The hidden page window was not verified in a running Electron window.
