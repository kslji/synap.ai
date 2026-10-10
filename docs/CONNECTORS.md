# Connectors

Assistant connectors are declared in `agents/assistant/connectors.json`. Each one has a name and a class list: read, write, or delete. The app does not send mailbox contents to a Surf server. Tokens, when they exist, stay in the operating-system keychain through Electron `safeStorage`. This build does not complete a live sign-in, so no token is stored yet.

## What is wired

- The connector list: Gmail, Google Calendar, Google Drive, Outlook mail and calendar, Slack, local alarms, and local files. Each row says Not connected.
- OAuth PKCE helpers: a random verifier and an S256 challenge. The loopback redirect and the system browser are the planned sign-in path. They are not opened yet, because no client id is shipped.
- An MCP URL is allowed only when its host is on the allow list. `evil.example` is rejected.
- A sample inbox on this computer. The body is filtered with the same injection sanitizer as web pages. "Ignore previous instructions" is dropped. "The berth is North." stays.
- Approval cards for a reply and for trash, enforced in the main process. See `docs/AGENTS.md`.
- An outbox object for a send that is waiting. It is memory for the sample, not a queue that survives restart, and it does not talk to Gmail.

## What is deferred

- Google, Microsoft, and Slack client ids, the system-browser login, and incremental consent screens.
- Encrypted offline mail cache and a durable outbox.
- Operating-system notifications for alarms, and a launch-at-login helper.
- Scheduled invoice email with a PDF attached.
- A stdio or HTTP MCP client process. Only the allow-list check exists.
- Cold email campaigns. They are refused, and there is no campaign feature to turn on.

## Google

One Google sign-in is the plan, with the smallest scope that matches the action, and extra scopes only when you ask for Calendar or Drive. Expected scopes later:

- Gmail read and send (`gmail.readonly`, `gmail.send`). Full mailbox permission is not the default.
- Calendar events you choose to read or create.
- Drive files you search. Surf does not ask for every file in the drive up front.

Google's app verification, and CASA if a restricted scope is ever requested, are not started. Because no Surf server reads the mail, the verification packet should describe a desktop app with a loopback redirect. Do not add a backend that stores message bodies in order to "make verification easier."

## Microsoft

Outlook mail and calendar go through Microsoft Graph with the same read, approve, and double-confirm rules. Publishing as a verified publisher is a later store step. This build has no Azure app registration.

## Slack

Slack uses a user token for the channels you are already in, not a bot that posts as the workspace. Slack's distribution limits apply when the app is shared outside this computer: a public listing needs their review, and a token from one workspace does not grant another. Posting still waits for Approve.

## Gmail sending limits

Gmail's own limits still apply once send is real. Consumer accounts are on the order of 500 messages a day, and Google Workspace limits are higher and depend on the account. Surf does not raise that limit and does not queue a campaign to get around it. A scheduled invoice is one message you approved, not a blast.

## Privacy

Mail, Slack, and web pages are untrusted data. The model sees the filtered text and cannot skip the approval gate. An audit list on the gate records allow, approve, cancel, and trash. Disconnect, once sign-in exists, will delete that connector's token from `safeStorage` and the local cache. The sample inbox is not a real account and is reset when the delete preview is opened.
