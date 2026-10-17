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

The Release workflow runs the CI checks first, including the no-fabrication gate, the Step 11 suite, and the Qwen 2B model-eval job. That job's no-fabrication floor is 1.0. It then runs model-eval-full and reads those results before any installer is built. A 2B, 4B, or 9B row that the runner could not load must already be in `harness/baselines/model-eval-full.json` from `./scripts/model-eval-full.sh`. Installers are built only after those checks pass. macOS and Windows are smoke-tested (database opens, llama-server starts, the process quits). Linux builds an AppImage and smoke-tests it the same way. The workflow publishes a GitHub Release with the installers, `latest*.yml`, `SHA256SUMS`, and generated notes. A tag that contains `-beta` is a prerelease. Installer builds pass `--publish never`. electron-builder would otherwise try to upload from CI and fail without `GH_TOKEN`. The Release workflow uploads the artifacts itself.

The app version in `apps/desktop/package.json` should match the tag without the leading `v`.

## Smoke test

CI sets `SURF_SMOKE=1` and launches the built binary. That opens an encrypted database, checks the unpacked native addons, pdf.js, and tesseract data, runs `llama-server --version`, and exits. It does not download a model.

## Dev mode and the licence screen

Dev mode is the default until a release flag is set. The app opens on the chat screen, the licence activation screen stays in the code but does not run, and the app does not call `synap.surf` or `api.synap.surf`. Pack sync and licence refresh stay off. Settings shows a Dev mode badge, and the sync chip says "Dev mode, sync off".

Turn the licence gate back on with one of these:

| Switch | Effect |
|---|---|
| `SYNAP_DEV_MODE=0` | This launch requires a licence. |
| `"release": true` in `apps/desktop/resources/release-mode.json` | Installers built with that file require a licence. `macSigned` is unchanged. |
| `SYNAP_RELEASE=1` | This launch requires a licence, same as the file flag. |

`SYNAP_DEV_MODE=1` forces dev mode even after the release flag is set. `SYNAP_LICENCE_DEV=1` still skips the licence check on an unpackaged build only.

## Model choice before install

The website offers Qwen 2B, 4B, and 9B before the Mac and Windows buttons. Every choice downloads the same installer. The GGUF is not inside the disk image or the `.exe`.

After the installer starts, the page links to `synap://setup?model=<registry id>`. The app registers that scheme on launch (`setAsDefaultProtocolClient`) and electron-builder writes it into the installer. Unsigned macOS often ignores the scheme until the app has been opened once, so the page says to open Synap first, then use the link. If no link arrives, the first-run screen downloads Qwen 2B. A link that arrives while another download is still running switches to the chosen file. A local GGUF can still be picked under Settings → Offline Models & Compute.

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
