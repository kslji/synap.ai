# Moss — text document retrieval

This Surf pack uses **Moss** as the **text document retrieval** layer (hackathon requirement).

## What Moss does

1. Indexes text from files you attach (while online).
2. On each question, retrieves relevant snippets from that text store.
3. Those snippets are added to the prompt; the **local model** (Ollama / in-browser) writes the answer.

Moss does **not** generate the reply. It only retrieves document text.

## Where invigilators can see it

| Place | What to look for |
|---|---|
| Sidebar “What's running” | `Moss (text document retrieval): on · … pieces` |
| After a reply that used Moss | Cite line: `Moss retrieval N ms` |
| This pack | `moss_bridge.py` + sealed `moss_vault.enc` |
| Setup | `LOCAL-SETUP` starts the Moss bridge on `:18767` when online |
| Evals | `bash harness/run-evals.sh` includes Moss vault + default search |

## Online / offline

- **Online:** Moss bridge retrieves (SDK when credentials unseal; keyword fallback otherwise).
- **Offline:** Moss paused; chat + local model still work.

## Verify

```bash
bash harness/run-evals.sh
```

Look for `PASS moss-vault`, `PASS moss-bridge`, `PASS moss-default-search`.
