# Agents

Surf ships three agent cards. Each card is `agents/<id>/agent.json`: the name, what it will and will not do, the system prompt, a chat model id per RAM tier, the tool allowlist, the retrieval index, and the harness suite. The home screen lists General, Code + UI, and Assistant. Marine stays on the sidebar as later.

The main process loads the cards. A chat is tagged with the card id. General keeps the system prompt the eval already scores. Code and Assistant add their own prompt in front of that same untrusted-passage rule. Web search still uses `/v1/search` when you are online and signed in, and it stays off when you are offline. Every retrieved passage, including mail, goes through the same injection filter.

## Models

| RAM | Chat model | File |
|---|---|---|
| Under 8 GB | Qwen3.5 2B | `Qwen3.5-2B-Q4_K_M.gguf` |
| About 8 GB | Qwen3.5 4B | `Qwen3.5-4B-Q4_K_M.gguf` |
| About 16 GB | Qwen3.5 9B | `Qwen3.5-9B-Q4_K_M.gguf` |
| 32 GB and up | Qwen3.6 35B-A3B, optional | `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` |

The 2B, 4B, and 9B files are Apache-2.0 GGUFs from Unsloth. The 35B file is `unsloth/Qwen3.6-35B-A3B-GGUF` `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (about 22 GB, Apache-2.0). There is no plain `Q4_K_M` filename in that repo. It is optional: the default suggestion on a 32 GB computer stays the 9B, and the Models screen offers the 35B as a separate download. The app checks the sha256 before it keeps a file.

One llama-server runs at a time. Starting a chat model stops the embedding server, and the next search starts it again.

Triage uses the installed 2B with thinking off and a JSON schema (`priority`, `summary`, no extra keys). A `bypass` field is rejected. The schema is not yet sent on the live chat path.

Fill-in-the-middle autocomplete is `unsloth/Qwen2.5-Coder-1.5B-Instruct-GGUF` `Qwen2.5-Coder-1.5B-Instruct-Q8_0.gguf` (Apache-2.0). The prompt markers are `<|fim_prefix|>`, `<|fim_suffix|>`, and `<|fim_middle|>`. The file is an optional download. A second llama-server is not started, so live autocomplete is not wired.

### Adapter slot

No LoRA ships. Chat entries accept an `adapter` object (`file`, `base`, optional `sha256`) and the 4B entry sets it to `null`. A later free adapter trained on Kaggle or Colab can be dropped in beside the base GGUF. This build does not download one.

## Embeddings

EmbeddingGemma 2 stays the index for Assistant, documents, and packs. Code search in this build is a symbol index: functions and classes are split with a regex (tree-sitter WASM is not bundled) and ranked with a small BM25-style score over the name and the path.

The harness records the bake-off decision:

| Candidate | Decision |
|---|---|
| EmbeddingGemma 2 | Stays for documents and Assistant. |
| Qwen3-Embedding-0.6B | Apache-2.0 official GGUF `Qwen/Qwen3-Embedding-0.6B-GGUF` `Qwen3-Embedding-0.6B-Q8_0.gguf`. Optional download. It is a `code-embedding` so it does not replace EmbeddingGemma. |
| CodeRankEmbed | MIT (`nomic-ai/CodeRankEmbed`). No official Unsloth or ggml-org GGUF, so it is not shipped. |

The shipped code index is `bm25-symbols`. That is a measurement of the index we run, not a claim that a neural model lost a cosine bake-off. The 0.6B file was not downloaded in CI.

## Code + UI

Code + UI is for product and SaaS work. The card says it is not for trading or HFT. Before the model is called, a request about high-frequency trading, market making, a trading bot, or an order-book scalp is refused. The word "trade-off" is not a trading request.

Wired:

- Architecture tab with an HLD, a Mermaid block, and an ADR. Asking in chat uses the code system prompt, which asks for that shape.
- HTML, CSS, and JavaScript preview in an iframe. `sandbox` is `allow-scripts` only. The document CSP blocks network, remote images, and forms. Remote script tags and inline event handlers are stripped.
- JavaScript runs in a worker with no `fetch`, and a timeout kills the loop. Python returns an explanation that Pyodide is not bundled. Rust, Go, and the other languages are not executed.
- Symbol search on a built-in sample, or on a folder you pick. The folder is read-only until you approve a diff. Approve writes only when that folder is attached and the file still matches the preview.
- License lines are read from `package.json` files under the attached folder. Apache-2.0 and MIT pass. Anything else is labeled. This does not phone a license service.
- Chips send a review, test, regex, SQL, or commit-message request to the code agent. The model writes the text. There is no separate OWASP scanner and no SQL database.

Deferred: Pyodide, tree-sitter WASM, Sucrase or esbuild-wasm for React, and live fill-in-the-middle.

## Assistant

Assistant drafts replies and invoices on this computer. Cold email campaigns are refused before the model is called. A reply to someone who already wrote is allowed, and it still waits for approval.

The approval gate lives in the main process. The model cannot set a bypass flag. Read is automatic. Send, modify, schedule, and create show a preview with Approve, Edit, and Cancel. Delete asks twice. The second button stays disabled for five seconds. A delete moves the sample message to trash.

Invoice tax is integer cents in code: India GST at 18 percent, US/EU VAT at 20 percent. Numbers look like `INV-2026-0007`. A "tomorrow at 09:00" schedule is UTC. Hindi labels such as `राशि` are kept. The PDF, DOCX, and XLSX invoice files, the local scheduler, and launch-at-login are not built yet.

See `docs/CONNECTORS.md` for sign-in, privacy, and what is still deferred.

## Harness

`apps/desktop/src/main/core/agent-suite.ts` prints measurements. `harness/core/agents.py` scores them. Quick mode runs this before Electron. The floor is 1.0.

Not in quick mode: full HumanEval+, MBPP+, LiveCodeBench, BFCL, or When2Call downloads. Those sets need a license pass and a model call per item. The cases here are the policy, sandbox, invoice, and retrieval checks that have to pass on every pull request.
