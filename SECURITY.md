# Security

**Draft — not legal advice.** This describes the controls in the app. It is not a certification, and it is not a claim that data cannot be leaked.

- The local database uses SQLCipher.
- Connector tokens are stored with the operating system keychain when that is available.
- Writes and deletes go through an approval gate in the main process. Delete asks twice.
- Retrieved text is treated as untrusted data. A sanitizer drops instructions that ride along inside a document or a web page.
- Knowledge packs are signed with Ed25519 and checked by hash before install.
- Code preview and the script sandbox do not get the network.
- Telemetry is off by default. Logs stay on the computer, under the app’s data folder.
- The source is public: https://github.com/kslji/synap.ai

## Reporting a problem

Write to the contact address published as `SITE_CONTACT_EMAIL` on the website (the placeholder is `contact@example.com` until the founder sets it). Please describe the version, the operating system, and the steps. Give the maintainers a reasonable chance to fix the issue before posting the details in public.
