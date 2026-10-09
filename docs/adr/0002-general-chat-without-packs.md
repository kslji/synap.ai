# ADR 0002 — General chat before any pack is installed

The orchestrator is: retrieve, relevance gate, then either a refusal or a token-budgeted prompt.

On a fresh install there is no pack and no attachment index. Treating that empty library as a failed gate would make the app refuse every question until Day 6. That is not a useful Day 1.

So:

- No verified packs: skip retrieval and answer with the local model. Numbers that are a plain expression or a unit conversion are computed by the calculator worker and never sent to the model.
- Packs or documents present and the gate says insufficient: search the web when the machine is online, Offline only is off, and web search is allowed. Otherwise reply "I don't have enough information to answer that from the sources on this computer." plus a short hint. User documents are not uploaded. Only the rewritten search queries are sent.
- Packs are opened only after `pack-verify.ts` accepts the signature and every file hash (Step 4).
