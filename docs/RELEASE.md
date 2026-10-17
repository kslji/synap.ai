# Releasing Synap.surf

Draft notes for the person cutting a build. This is not a legal document.

Installers are free GitHub Actions artifacts. There is no Apple Developer membership and no Windows code-signing certificate in this setup. macOS gets an ad-hoc signature (`codesign -s -`) so Apple Silicon will launch the app. Gatekeeper and SmartScreen still warn. The website download page explains the one-time bypass.

## Disk images are separate

`electron-builder.cjs` builds two macOS disk images, arm64 and x64, instead of one universal image. A universal app contains both architectures, so every download would be about the size of both. A person on Apple Silicon downloads only the arm64 image. The display name is Synap.surf. The binary is SynapSurf (no dot, so Windows does not treat it as a `.surf` file). Artifacts are named `Synap.surf-<version>-<arch>.<ext>`.

Windows is one NSIS `.exe` for 64-bit, installed for the current user, with `allowElevation: false`, so it does not ask for an administrator account.

## How to tag

Stable:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Beta (GitHub marks it as a prerelease, and the in-app beta channel can see it):

```bash
git tag v0.2.0-beta.1
git push origin v0.2.0-beta.1
```

The Release workflow runs the CI checks first, including the no-fabrication gate, the Step 11 suite, and the Qwen 2B model-eval job. That job's no-fabrication floor is 1.0. It then runs model-eval-full and reads those results before any installer is built. A 2B, 4B, or 9B row that the runner could not load must already be in `harness/baselines/model-eval-full.json` from `./scripts/model-eval-full.sh`. Installers are built only after those checks pass. macOS and Windows are smoke-tested (database opens, llama-server starts, the process quits). Linux builds an AppImage and smoke-tests it the same way. The workflow publishes a GitHub Release with the installers, `latest*.yml`, `SHA256SUMS`, `offline-packages.json`, any offline zip that fits, and generated notes. A tag that contains `-beta` is a prerelease. Installer builds pass `--publish never`. electron-builder would otherwise try to upload from CI and fail without `GH_TOKEN`. The Release workflow uploads the artifacts itself. Offline zips are built only on a `v*` tag, not on a pull request.

The app version in `apps/desktop/package.json` should match the tag without the leading `v`.

## Smoke test

CI sets `SURF_SMOKE=1` and launches the built binary. That opens an encrypted database, checks the unpacked native addons, pdf.js, and tesseract data, runs `llama-server --version`, and exits. It does not download a model.

## Dev mode and the licence screen

Dev mode is the default until a release flag is set. The app opens on the chat screen, the licence activation screen stays in the code but does not run, and the app does not call `api.synap.surf`. Pack sync and licence refresh stay off. Settings shows a Dev mode badge. The sidebar chip follows the real sync state and does not say Dev mode, and Settings and Packs show "Dev mode, sync off." The first open with no chat model shows the model picker; after a model is installed, dev mode opens on the chat screen. The only `synap.surf` link in dev mode opens the public site in the system browser so a model file can be saved there. `/buy` and the API stay blocked.

Turn the licence gate back on with one of these:

| Switch | Effect |
|---|---|
| `SYNAP_DEV_MODE=0` | This launch requires a licence. |
| `"release": true` in `apps/desktop/resources/release-mode.json` | Installers built with that file require a licence. `macSigned` is unchanged. |
| `SYNAP_RELEASE=1` | This launch requires a licence, same as the file flag. |

`SYNAP_DEV_MODE=1` forces dev mode even after the release flag is set. `SYNAP_LICENCE_DEV=1` still skips the licence check on an unpackaged build only.

## Model files

There is one small installer per operating system and architecture: `Synap.surf-<version>-<arch>.dmg` or `.exe`. No model is inside that installer. The website still has Download for Mac, Download for Windows, and Download for Intel Mac. On first open the app asks the person to pick Qwen 2B, 4B, or 9B. The search model (EmbeddingGemma, `embeddinggemma-2-Q8_0.gguf`, 309,855,520 bytes) is downloaded with whichever they pick, because Library files, fetched pages, and docs packs need it. The files go into the app data folder, outside the bundle, so an update does not fetch them again. The screen names both files and shows their combined bytes, can pause, and resumes after a dropped connection or a restart. It checks the SHA-256 before it keeps a file. Chat opens only after both files match. If a matching Qwen file is already in Downloads, the app offers to use that file instead of downloading it. A matching search-model file in Downloads is copied without a separate question. If that file is missing or the checksum fails on a later launch, the same screen downloads it again. Keyword search is used only while that download is running, or while the computer is offline, and the chat says so.

Each size row also has Download (the same small installer; the model still downloads on first open) and Offline installer. The offline package is a zip of the app plus that Qwen file plus the search model. First open copies both files into the app data folder, checks the SHA-256, and opens chat. It does not use the network.

| Size | Qwen file | Qwen + search model |
|---|---:|---:|
| 2B | 1,280,835,840 bytes (1.28 GB) | 1,590,691,360 bytes (1.59 GB) |
| 4B | 2,740,937,888 bytes (2.74 GB) | 3,050,793,408 bytes (3.05 GB) |
| 9B | 5,680,522,464 bytes (5.68 GB) | 5,990,377,984 bytes (5.99 GB) |

The zip is larger than those model bytes because the app is in it too. The release measures the finished zip. `offline-packages.json` on the GitHub Release is the list the website reads. Until that file exists, the website shows the model totals above and labels them "of models". It does not invent an app-overhead number, and a row without a real URL is not a link.

### Why the offline package is a zip

NSIS, which builds the Windows `.exe`, stores the payload in one data block of about 2 GiB (`2,147,483,648` bytes). The 4B GGUF alone is 2,740,937,888 bytes, so it cannot be one NSIS file. A larger NSIS fork still keeps a single compressed file under 2 GB, and the GGUF does not shrink that far. asar, the format inside the app bundle, refuses a package around 4.2 GB. The 9B file is 5,680,522,464 bytes, so the models stay outside asar, under `Contents/Resources/setup-models` on Mac and `resources/setup-models` on Windows.

A disk image can be large, but a 9B image is about 6 GB, GitHub cannot host it, and this repository cannot check a Mac-only image from Linux. One zip per size is the package for both systems. Info-ZIP writes ZIP64 when a file passes 4 GB, which the 9B zip does. The person downloads one file.

Mac: open the zip, open Synap.surf. If macOS blocks it, System Settings → Privacy & Security → scroll to Security → Open Anyway, once. Chat opens. Nothing downloads.

Windows: extract the zip, open `Synap.surf/SynapSurf.exe`. If SmartScreen appears, More info, then Run anyway. Chat opens. Nothing downloads.

The Mac zip is ad-hoc signed again after the models are added (`codesign --force --sign -`, not `--deep`), on the macOS runner. The Windows zip is not signed.

### Where the zip is hosted

GitHub Releases rejects one asset at 2 GiB (`2,147,483,648` bytes). The workflow measures the zip. If it is under that, the zip is attached to the GitHub Release. If it is not, the zip is uploaded to the public Hugging Face dataset `kslji/synap-surf-offline` and then deleted from the runner, so it is not attached to the Release. The 4B and 9B model pairs are already over 2 GiB before the app is added, so those zips go to Hugging Face. The 2B pair is 1,590,691,360 bytes. Whether the finished 2B zip still fits is decided by the measured file, not by this paragraph.

Hugging Face, checked against the Hub storage and rate-limit docs: a free account's public storage is best-effort, not a fixed quota. Private storage on the free tier is 100 GB. There is no per-repo size cap; uploads count against the account. The hard limit for one file is 500 GB, and Hugging Face recommends keeping a file under 200 GB. A 9B zip is about 6 GB. Files are served through CloudFront. Resolver limits are request counts (about 3,000 per 5 minutes for an anonymous address, about 5,000 for a free account), not a published per-gigabyte bandwidth cap. Cloudflare R2's free tier is 10 GB, which is smaller than one full set of these zips. The Internet Archive is free and a poor download page. The dataset is the host.

GitHub documents about 14 GB of free disk on a standard runner, and a public runner is often larger. The script asks for the app copy, the zip, the model download when the files are not already on disk, and 1 GB of margin. For an 800 MB app and the 9B models that is 14,654,497,792 bytes. A runner with only 14,000,000,000 bytes free stops and prints how many bytes it needs and how many are free. It does not upload a partial zip. The script checks the disk it actually has.

If a zip needs Hugging Face and `HF_TOKEN` is missing, the job fails and names the size, the byte count, the secret, and the dataset. It does not skip 4B or 9B. `HF_TOKEN` is a GitHub Actions secret. It is not committed.

### One-time Hugging Face setup

1. Create a **public** dataset repo named `kslji/synap-surf-offline` at [huggingface.co/new-dataset](https://huggingface.co/new-dataset). Public is required so the website can link to a file without a token. A private repo would fit in the 100 GB free private tier and the site still could not fetch it.
2. Create a write token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). A fine-grained token needs write access to that dataset.
3. In the GitHub repo, Settings → Secrets and variables → Actions → New repository secret. Name it `HF_TOKEN`. Paste the token. Do not put the token in a file, a workflow, or a commit.
4. Optional: if the dataset name is different, add a repository variable `HF_OFFLINE_REPO` set to `owner/name`. The default is `kslji/synap-surf-offline`.
5. Tag `v*` as usual. The offline jobs download the models, build one zip per size (Mac arm64, Mac Intel, Windows), upload anything at or over 2 GiB to the dataset, and write `offline-packages.json`.

The recommendation follows the same RAM tiers as the rest of the app: under 8 GB is 2B, the 8 GB class is 4B, and 16 GB and above is 9B. Unknown RAM suggests 2B and does not add the recommendation tag. A size that needs more memory than the computer has stays selectable and shows the warning. Settings, Models can download or switch to another size later. The URLs, sizes, and SHA-256 values are in `apps/desktop/resources/models.registry.json`.

## How to turn on signing later

Leave these unset until a certificate exists. With them empty, builds stay unsigned and macOS uses the ad-hoc signature.

| Secret | Used for |
|---|---|
| `CSC_LINK` | Base64 certificate (`.p12`). macOS Developer ID or Windows Authenticode. |
| `CSC_KEY_PASSWORD` | Password for that certificate. |
| `APPLE_ID` | Apple ID for notarization. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization. |
| `APPLE_TEAM_ID` | Team id for notarization. |

When `CSC_LINK` is set, `electron-builder.cjs` stops the ad-hoc signature, turns on the hardened runtime, and notarizes if `APPLE_ID` is also set. Before that build, write `{"macSigned": true}` to `apps/desktop/resources/release-mode.json` so the app uses in-place update instead of the disk-image banner. Unsigned macOS cannot update in place. Windows NSIS can, including while the installer is unsigned. SmartScreen may still show Unknown publisher.

Repository variable `SURF_RELEASE_TYPE=prerelease` is only needed if a stable-looking tag should be published as a prerelease. `-beta` tags already are.

## Website contact

`SITE_CONTACT_EMAIL` is the only contact address. The default in the site is `contact@example.com`. Set it for the website build. `SITE_FORM_KEY` is a free [Web3Forms](https://web3forms.com) access key. The contribute form posts to Web3Forms from the browser. This repository does not store the message. Without the key, the page falls back to a `mailto:` link. See the contribute page for the honeypot and the short rate limit.
