# How to add a new agent card

Add a folder and an `agent.json`. The website and the desktop agent list read that file at build time. You do not edit the layout.

```
agents/<id>/agent.json
```

`<id>` is the folder name: lowercase letters, numbers, and hyphens. The card uses that id.

Required fields:

| Field | Meaning |
|---|---|
| `name` | The label on the card |
| `tagline` | One short line under the name |
| `description` | A sentence or two |
| `status` | `available`, `beta`, or `coming soon` |
| `order` | Sort number. Lower comes first |

Optional: `icon` (any short string; an unknown value still renders), `accent` (a color), `notes` (a line such as “Not for trading or HFT”).

On the website, only `available` links to the download. `beta` and `coming soon` show a badge and no download. In the desktop app, `available` and `beta` get a Start chat button and their own chat history. `coming soon` stays on the card. If the agent is not actually in this build, do not mark it `available`.

Example:

```json
{
  "name": "Marine",
  "tagline": "Ships and ports",
  "description": "Answers from the marine pack once it is published.",
  "icon": "anchor",
  "accent": "#F97316",
  "status": "coming soon",
  "order": 4
}
```
