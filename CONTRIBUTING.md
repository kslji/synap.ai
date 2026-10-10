# Contributing

**Draft — not legal advice.**

The website has a contribute form at `/contribute`. It asks for a name, an email, a role (code, testing, design, docs, niche pack, or joining the team), an optional GitHub or portfolio URL, and a message.

The form is delivered by [Web3Forms](https://web3forms.com), a free form-to-email service. The browser posts the message there. This server does not store it. A hidden honeypot field and a short client-side wait between submits cut down automated posts. If `SITE_FORM_KEY` is not set at build time, the page offers a `mailto:` link instead.

`SITE_CONTACT_EMAIL` is the only contact address. The default is `contact@example.com`. Set both values when building `apps/web`:

```bash
SITE_CONTACT_EMAIL=you@example.com SITE_FORM_KEY=your-web3forms-access-key npm run build -w @surf/web
```

Create the access key at https://web3forms.com with the same inbox you put in `SITE_CONTACT_EMAIL`.

Code changes belong in a pull request against this repository. Please do not add a paid signing certificate or a telemetry default of on.

## Agent cards

To add an agent to the website and the desktop list, add `agents/<id>/agent.json`. The layout does not change. See `docs/AGENTS.md`.
