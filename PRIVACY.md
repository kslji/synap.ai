# Privacy

**Draft — not legal advice.** This note describes how Synap.surf is designed. It is not a certification, and it is not a promise that data cannot be leaked. A stolen computer, a bug, or malware on the machine can still expose files.

Designed around the India Information Technology Act 2000 and the Digital Personal Data Protection Act 2023, the EU and UK GDPR, and the California CCPA/CPRA. Those names describe the goals of the design. They are not a claim of certified compliance.

- Chats and documents stay on the device in an encrypted database. The key is held by the operating system keychain when that is available.
- The on-device chat runs locally. The optional cloud chat (`/api/v1/chat`) is different: your prompt and recent chat turns are sent through our server to OpenRouter and the model provider you pick, and the server stores that chat history and a billing record for your account. Our server logs only counts, not prompt or answer text.
- The app reads only folders and files you pick. It does not edit, move, or delete those files on its own.
- Sending, modifying, or deleting mail and similar actions waits for your approval. Delete asks twice.
- There are no ads and no sale of data.
- Crash reports are off by default.
- To delete everything the app stored, quit Synap.surf and remove its data folder: `~/Library/Application Support/surf-ai` on macOS, or `%APPDATA%\surf-ai` on Windows. That removes the encrypted database, downloaded models, and logs.

The contact address is the `SITE_CONTACT_EMAIL` value on the website. Until that is set, the site shows `contact@example.com`.
