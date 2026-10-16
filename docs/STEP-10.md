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
- SEBI and RBI items are their RSS feeds. If a feed fails, the answer uses the unable sentence below. It does not invent one.
- A stock or share price question fetches public quote pages once, on that ask. The list is pluggable and region-aware: ET Markets and Moneycontrol for India, Yahoo Finance for every region. The laptop reads the displayed price and the page timestamp. It does not call a hidden JSON quote API and it does not use yfinance. Nothing polls in the background.
- The answer says `Reported price as of <date, time, local tz>`. Source chips are `Site name +N` and open the exact page. The shown number has to be the extracted text. A mismatch, a missing timestamp, or a failed page uses the unable sentence.
- That quote is stored on disk for 60 seconds. A repeat ask inside that minute shows the same price and the original as-of time, and does not fetch again. After 60 seconds the next ask fetches again.
- End-of-day NSE and BSE files remain the path for an injected bhav copy. Those downloads often fail from a datacenter. Failure is the designed result.
- Every finance answer includes the disclaimer that this is not a recommendation to buy or sell.

Legal answers quote a local document or an India Code search result and say "This is not legal advice." India Code is one provider. Another country is another entry in `LEGAL_PROVIDERS`. If the section is not in the sources, the answer says so and does not invent a section.

A figure is allowed only when the fetch succeeded and the source date is inside its window: coin prices 6 hours, mutual-fund NAV 7 days, exchange end-of-day files 10 days, news and circulars 14 days. A future date, a blank date, or a clock older than that window is not usable. The answer then is exactly one of these, plus the finance or legal disclaimer, and it has no citation:

- `Unable to find the price right now. Please try again in a moment.`
- `Unable to find that news right now. Please try again in a moment.`
- `Unable to find that section right now. Please try again in a moment.`
- `Unable to find that fact right now. Please try again in a moment.`

The same sentences are used when AMFI, CoinGecko, NSE, BSE, SEBI, RBI, India Code, or DuckDuckGo time out, return nothing, or return a partial row. A number typed in the question does not count as a fetched price. SIP, P&L, and the tax table stay in-app maths: the displayed figure is the citation excerpt, not a live quote.

After the model writes an answer, `verifyGroundedAnswer` checks prices, other numbers on a price question, dates, URLs, section numbers, and quotes against the source records in context. Anything that does not match is removed by replacing the answer with the unable sentence above. Citations on that answer are dropped. A cached row that is still inside its window is kept and labeled `Cached on YYYY-MM-DD. Not a live fetch.` It is not described as live. The offline refusal for a general question such as rope price stays the existing sentence; that path does not call a source.

The `no-fabrication` suite is a blocking gate on quick and full evals (`min_score` 1.0). It does not call the live sites. It feeds timeouts, empty bodies, stale dates, partial rows, unknown funds and tickers, future dates, prompts that press for a guess, and quote-page fixtures (extraction, a 60-second cache, disagreeing pages, and a number that does not match the page).

Web-derived answers keep an `[S1]` marker. Pack citations can include a pack version line. The fresh-info eval case is still `web-saved` (beacon `SB-4417`) on the fixture. Finance and legal eval cases are answered in code before the model.

## Pack deltas

`services/packs/build_delta.py` collects a sitemap, RSS, arXiv, or Hugging Face feed, writes a sqlite delta, encrypts it with NaCl SecretBox, and signs the manifest. The catalog's `delta` field is that `delta.sqlite.enc` file when the bundle contains one.

`--fixture-embed` uses a SHA-256 hash vector so tests do not need llama-server. That is not EmbeddingGemma. A real build passes `--embed-url` to a local llama-server. Keys are `PACK_SIGNING_KEY_HEX` and `PACK_CONTENT_KEY_HEX`. They are empty in `.env.example`.

Chat still opens plaintext `pack.sqlite` when that file is present. That path is unchanged.

The builder content key and the licence-derived key are different. `GET /v1/packs/updates?device_id_hash=` returns `content_key_sealed` when `PACK_CONTENT_KEY_HEX` is set and that account has an active licence on that device. The value is a NaCl SecretBox of the 32-byte content key. The wrap key is SHA-256 of `synap.pack.v1`, the licence id, and the device hash — the same string `derivePackKey` uses. The raw content key is not in the response. A missing key, a licence that is not active, or a device that is not activated leaves `content_key_sealed` null. The catalog is otherwise unchanged.

The app unwraps that seal on pack sync, and again when chat finds a delta and no cached key. The unwrapped key is stored with Electron `safeStorage` (`pack-content.key.enc`, mode 0600). Linux `basic_text` and a machine with no OS secret store keep it in process memory only. It is not written as plaintext. `SURF_PACK_CONTENT_KEY` is an operator override and stays empty on a normal install.

When `delta.sqlite.enc` is in the installed folder, chat checks the manifest signature and the file hash again, then decrypts with the cached content key (or the operator override). The licence-derived key does not decrypt the file. A wrong key or a missing seal leaves the delta sealed and still uses `pack.sqlite` if it is there. A decrypted copy is written under the app's data folder, outside the signed directory. Delta search uses the float32 embedding blobs plus keyword overlap, because that file has no FTS5 or vec0 index.

Tests use the `22` repeated test content key. The API test builds a delta with `write_pack`, seals the key through `/v1/packs/updates`, and decrypts that file. The desktop test opens the same kind of builder bytes from `fixtures/builder-delta.json` after unwrapping the seal. Both sides assert the same wrap-key hex.

## Not in this step

- No feedback table, feedback IPC, or thumbs control.
- No Reddit or X connector.
- The full DB-IP database is not bundled.
- The hidden page window was not verified in a running Electron window.
