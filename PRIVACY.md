# Privacy

**Draft — not legal advice.** This note describes how Surf AI is designed. It is not a certification, and it is not a promise that data cannot be leaked. A stolen computer, a bug, or malware on the machine can still expose files.

Designed around the India Information Technology Act 2000 and the Digital Personal Data Protection Act 2023, the EU and UK GDPR, and the California CCPA/CPRA. Those names describe the goals of the design. They are not a claim of certified compliance.

- Chats and documents stay on the device in an encrypted database. The key is held by the operating system keychain when that is available.
- The model runs locally. Prompts are not sent to a cloud model.
- The app reads only folders and files you pick. It does not edit, move, or delete those files on its own.
- Sending, modifying, or deleting mail and similar actions waits for your approval. Delete asks twice.
- Web search is off until you turn it on. A search sends only the short query, not your documents.
- There are no ads and no sale of data.
- Crash reports are off by default.
- To delete everything the app stored, quit Surf AI and remove its data folder: `~/Library/Application Support/surf-ai` on macOS, or `%APPDATA%\surf-ai` on Windows. That removes the encrypted database, downloaded models, and logs.

The contact address is the `SITE_CONTACT_EMAIL` value on the website. Until that is set, the site shows `contact@example.com`.
