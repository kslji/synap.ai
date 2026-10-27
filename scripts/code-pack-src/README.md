# Code pack build

`scripts/build-code-pack` downloads the pinned sources in `scripts/code-pack-src/catalog.ts`, cleans them to text, chunks them by heading, and writes a signed pack to `apps/desktop/resources/code-pack/`.

The pack is text plus a keyword index (`keyword.sqlite`). It does not contain embeddings. The desktop app builds Jina code embeddings on the device and caches them under the user data directory.

## One-time signing setup

The private seed never belongs in git. `pack-keys.json` holds only public keys. The id `code-pack-dev` is a development key. A production pack should use your own id.

1. Generate a key on a trusted machine:

   ```sh
   cd apps/desktop && npx tsx ../../scripts/code-pack-src/keygen.ts
   ```

2. Add the printed seed as the GitHub Actions secret `CODE_PACK_SIGNING_KEY` (64 hex characters, no `0x`).
3. Add the public key to `apps/desktop/resources/pack-keys.json`:

   ```json
   "code-pack-1": "<64 hex characters>"
   ```

4. Rebuild with the secret present:

   ```sh
   CODE_PACK_SIGNING_KEY=<seed> CODE_PACK_SIGNING_KEY_ID=code-pack-1 scripts/build-code-pack
   ```

5. Commit the new public key and the signed pack. Do not commit the seed.

A local rebuild without the secret can pass `--dev-key`. That writes `scripts/code-pack-src/.dev-seed` (mode 0600, gitignored) and, with `--update-dev-pubkey`, records the matching public key as `code-pack-dev`. The manifest note says the signature is a development signature.

GitHub Actions workflow `.github/workflows/code-pack.yml` runs the same build when you start it by hand. Fork pull requests do not receive the secret, so CI on pull requests verifies the committed pack instead of re-signing it.

## Delivery

The pack ships inside the installer (`electron-builder` `extraResources` → `code-pack/`). On first launch the app copies it into the user data directory and checks the Ed25519 signature and each file SHA-256.

It is not a separate release-asset download. The Code agent is the only active agent and has to answer offline, including the first launch in Offline-only mode. The curated pack is far under GitHub's 2 GiB release-asset limit, and it is small next to the Qwen weights the app already downloads from Hugging Face. A first-open fetch would fail offline and would add a second trust path.

The bytes are not SQLCipher-encrypted. The content key is per device, so it cannot be baked into a shared installer. `gatePackDecrypt` still refuses to open the chunk text without a valid licence (dev builds keep the existing dev bypass).

## Built pack

The committed pack is version `2026.10.17`, signed with the development key `code-pack-dev`.

- 7,781 chunks
- 14,946,146 bytes (14.3 MiB), including `keyword.sqlite`, `NOTICE`, `sources.json`, `manifest.json`, and `manifest.sig`

That is the size that ships in the installer. Embeddings are not included. They are built on the device.

## What is included

`NOTICE` in the pack lists every source, version, licence, and attribution. Anything whose licence did not allow redistribution is not in the pack. Oracle's Java SE documentation is not included. The Java rows are documentation comments from OpenJDK under GPL-2.0 with the Classpath Exception. The Pro Git book is not included (CC-BY-NC-SA). C and C++ pages come from the CC-BY-SA cppreference snapshot named in the catalog.
