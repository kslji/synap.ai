# Releasing Surf AI

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

The Release workflow builds macOS and Windows, smoke-tests each app (database opens, llama-server starts, the process quits), and publishes a GitHub Release with the installers, `latest*.yml`, `SHA256SUMS`, and generated notes. A tag that contains `-beta` is a prerelease.

The app version in `apps/desktop/package.json` should match the tag without the leading `v`.

## Smoke test

CI sets `SURF_SMOKE=1` and launches the built binary. That opens an encrypted database, checks the unpacked native addons, pdf.js, and tesseract data, runs `llama-server --version`, and exits. It does not download a model.

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
