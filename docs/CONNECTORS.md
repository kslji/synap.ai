# Connectors

Assistant connectors are declared in `agents/assistant/connectors.json`. Each one has a name and a class list: read, write, or delete. The app does not send mailbox contents to a Surf server. Tokens and the offline cache are one encrypted file. On macOS that file is sealed with the Keychain through Electron `safeStorage`, and on Windows with DPAPI. Linux uses libsecret when it is installed. If the OS has no secret service, the vault stays encrypted in memory for this launch, the same way a Surf sign-in session does.

## Client ids

Surf does not ship a Google, Microsoft, or Slack client id. Create one for the desktop app and put it in the environment, or in a json file you do not commit.

| Provider | Variable | Where to create it |
|---|---|---|
| Google | `SURF_GOOGLE_CLIENT_ID` | Google Cloud console. Application type: Desktop. Redirect: the loopback URL Surf prints, `http://127.0.0.1` with any port. |
| Microsoft | `SURF_MICROSOFT_CLIENT_ID` | Microsoft Entra app registration. Platform: Mobile and desktop. Redirect: `http://127.0.0.1`. Allow public client flows. |
| Slack | `SURF_SLACK_CLIENT_ID` and `SURF_SLACK_CLIENT_SECRET` | Slack API app. User token scopes only. Redirect: `http://127.0.0.1`. |

`agents/assistant/oauth.example.json` holds the placeholders `surf-dev-google`, `surf-dev-microsoft`, and `surf-dev-slack`. Those ids work only with the mock issuer in the harness and in screenshot capture. They are not registered with Google, Microsoft, or Slack.

Sign-in is OAuth 2.0 authorization code with PKCE. The system browser opens the provider. The redirect lands on `127.0.0.1` and Surf exchanges the code. Google starts with Gmail read and send. Calendar (`calendar.events`) and Drive (`drive.metadata.readonly`) are added only when you connect those rows. `include_granted_scopes` keeps the scopes you already approved. Microsoft Graph asks for mail read and send, then calendar. Slack asks for a user token (`channels:history`, `channels:read`, `chat:write`, `users:read`), not a bot token.

Refresh runs before the access token expires. Disconnect deletes the local token and calls the provider revoke endpoint when you are online.

## What is wired

- The connector list: Gmail, Google Calendar, Google Drive, Outlook mail and calendar, Slack, local alarms, and local files.
- The PKCE loopback above, tested against a mock Google, Microsoft, and Slack issuer. CI does not use a real account.
- An encrypted cache of recent mail and events. Offline reading uses the cache and does not call the network. Mail text goes through the injection filter. "Ignore previous instructions" is dropped. "The berth is North." stays.
- A durable outbox. An approved send stays on disk and is retried when the computer is online again. A scheduled send waits until its time.
- Launch at login via Electron `setLoginItemSettings` when a send or an alarm is still waiting. The argument is `--surf-flush`.
- Operating-system notifications for a due alarm.
- Approval in the main process. Read is automatic. Send, modify, schedule, and create need Approve. Delete needs two confirmations and a five-second wait, and the provider call is trash rather than a permanent delete. A `bypass` field cannot skip the gate.
- An MCP client for stdio (Content-Length frames) and HTTP. HTTP hosts must be on the allow list. `evil.example` is rejected. `agents/assistant/harbor-mcp.mjs` is the example connector: reading the harbor note is automatic, replacing it waits for Approve.

## Invoices

Templates are standard, GST India (18%), US/EU VAT (20%), freelancer, and recurring. Numbers look like `INV-2026-0007`. PDF, DOCX, and XLSX reuse the document exporters. A scheduled invoice email attaches the PDF and goes through the same approval gate. It is one message, not a campaign.

## Google

One Google sign-in, with the smallest scope that matches the action. Expected scopes:

- Gmail read and send (`gmail.readonly`, `gmail.send`). Full mailbox permission is not requested.
- Calendar events when you connect Calendar.
- Drive file names when you connect Drive. Surf does not ask for every file up front.

Google's app verification, and CASA if a restricted scope is ever requested, are not started. Because no Surf server reads the mail, the verification packet should describe a desktop app with a loopback redirect. Do not add a backend that stores message bodies.

## Microsoft

Outlook mail and calendar go through Microsoft Graph with the same read, approve, and double-confirm rules. Publishing as a verified publisher is a store step you do in Entra. This repository does not contain an Azure secret.

## Slack

Slack uses a user token for the channels you are already in. A public listing needs Slack's review, and a token from one workspace does not grant another. Posting still waits for Approve.

## Gmail sending limits

Gmail's own limits still apply. Consumer accounts are on the order of 500 messages a day, and Google Workspace limits are higher and depend on the account. Surf does not raise that limit and does not queue a campaign to get around it.

## Privacy

Mail, Slack, and web pages are untrusted data. The model sees the filtered text and cannot skip the approval gate. An audit list on the gate records allow, approve, cancel, and trash. Disconnect deletes that connector's token and its cached mail and events.

Cold email campaigns are refused. There is no campaign feature to turn on.
