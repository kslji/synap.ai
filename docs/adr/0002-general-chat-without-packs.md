# ADR 0002 — General chat before any pack is installed

The orchestrator is: retrieve, relevance gate, then either a refusal or a token-budgeted prompt.

On a fresh install there is no pack and no attachment index. Treating that empty library as a failed gate would make the app refuse every question until Day 6. That is not a useful Day 1.

So:

- No verified packs: skip retrieval and answer with the local model. Numbers that are a plain expression or a unit conversion are computed by the calculator worker and never sent to the model.
- Packs present and the gate says insufficient: do not call the model. Reply "I don't have enough information to answer that from the sources on this computer." If web search is allowed and the machine is online, append that web search is not connected yet (Day 4). Do not send the query anywhere.
- Packs are not opened at all until signature checks exist (Day 5). The retrieval functions are called only from that branch.
