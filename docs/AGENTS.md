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

Chat and embeddings still share one llama-server. Starting a chat model stops the embedding server, and the next search starts it again. Fill-in-the-middle is the exception: a second, smaller llama-server starts only when `Qwen2.5-Coder-1.5B-Instruct-Q8_0.gguf` is on disk and the machine has at least 4 GB of RAM.

Triage uses the installed 2B with thinking off and a JSON schema (`priority`, `summary`, no extra keys). A `bypass` field is rejected. The schema is not yet sent on the live chat path.

Fill-in-the-middle autocomplete is `unsloth/Qwen2.5-Coder-1.5B-Instruct-GGUF` `Qwen2.5-Coder-1.5B-Instruct-Q8_0.gguf` (Apache-2.0). The prompt markers are `<|fim_prefix|>`, `<|fim_suffix|>`, and `<|fim_middle|>`. The file is an optional download. The code editor asks that sidecar for one line. If the file is missing, the editor says to download it. CI does not download the 1.6 GB file.

### Adapter slot

No LoRA ships. Chat entries accept an `adapter` object (`file`, `base`, optional `sha256`) and the 4B entry sets it to `null`. A later free adapter trained on Kaggle or Colab can be dropped in beside the base GGUF. This build does not download one.

## Embeddings

EmbeddingGemma 2 stays the index for Assistant, documents, and packs. Code files are split with tree-sitter WASM (TypeScript, TSX, JavaScript, Python). If a grammar cannot load, the regex splitter is the fallback.

The code-retrieval bake-off is in `agents/code/bakeoff.json`. Eight paraphrased queries, recall@1:

| Candidate | Recall@1 |
|---|---|
| BM25 over symbols | 0.125 |
| EmbeddingGemma 2 (product 256-d spec) | 0.875 |
| Qwen3-Embedding-0.6B Q8, last-token pooling | 0.875 |
| Hybrid reciprocal-rank fusion | 0.375 |

Hybrid did not win. EmbeddingGemma and Qwen tied. The shipped code index is EmbeddingGemma, because that model is already used for documents and the scores were equal. Qwen3-Embedding stays an optional download. When its file is not installed, symbol search uses BM25. CodeRankEmbed (`nomic-ai/CodeRankEmbed`, MIT) has no official GGUF, so it was not converted and is not a candidate. CI does not download the 0.6B file. Re-run with `npx tsx src/main/core/bakeoff-run.ts` from `apps/desktop` when both GGUFs are on disk.

## Code + UI

Code + UI is for product and SaaS work. The card says it is not for trading or HFT. Before the model is called, a request about high-frequency trading, market making, a trading bot, or an order-book scalp is refused. The word "trade-off" is not a trading request.

Wired:

- Architecture tab with an HLD, a Mermaid block, and an ADR. Asking in chat uses the code system prompt, which asks for that shape.
- HTML, CSS, and JavaScript preview in an iframe. `sandbox` is `allow-scripts` only. The document CSP blocks network, remote images, and forms. Remote script tags and inline event handlers are stripped.
- React preview runs Sucrase in the app and puts the compiled script in that same iframe. Nothing is loaded from a CDN.
- JavaScript runs in a worker with no `fetch`, and a timeout kills the loop. Python runs in Pyodide (MPL-2.0) in a worker. The wasm ships with the app and is downloaded only when that copy is missing. The worker has a memory cap and no network. A `while True` loop is stopped. Rust, Go, and the other languages are not executed.
- Symbol search on a built-in sample, or on a folder you pick. Chunks come from tree-sitter. Ranking uses EmbeddingGemma when that GGUF is installed, and BM25 otherwise. The folder is read-only until you approve a diff. Approve writes only when that folder is attached and the file still matches the preview.
- License lines are read from `package.json` files under the attached folder. Apache-2.0 and MIT pass. Anything else is labeled. This does not phone a license service.
- Chips send a review, test, regex, SQL, or commit-message request to the code agent. The model writes the text. There is no separate OWASP scanner and no SQL database.
- The code editor requests a fill-in-the-middle suggestion from the coder sidecar when that model is installed.

## Assistant

Assistant drafts replies and invoices on this computer. Cold email campaigns are refused before the model is called. A reply to someone who already wrote is allowed, and it still waits for approval.

The approval gate lives in the main process. The model cannot set a bypass flag. Read is automatic. Send, modify, schedule, and create show a preview with Approve, Edit, and Cancel. Delete asks twice. The second button stays disabled for five seconds. A delete moves the sample message to trash.

Invoice tax is integer cents in code: India GST at 18 percent, US/EU VAT at 20 percent. Numbers look like `INV-2026-0007`. A "tomorrow at 09:00" schedule is UTC. Hindi labels such as `राशि` are kept in the DOCX and spreadsheet. The PDF uses the same totals with the standard font, so letters outside that font are replaced. PDF, DOCX, and XLSX are built with the document exporters. A scheduled invoice email carries the PDF and still waits for Approve.

See `docs/CONNECTORS.md` for sign-in, the outbox, and privacy.

## Harness

`apps/desktop/src/main/core/agent-suite.ts` prints measurements. `harness/core/agents.py` scores them. Quick mode runs this before Electron. The floor is 1.0.

Not in quick mode: full HumanEval+, MBPP+, LiveCodeBench, BFCL, or When2Call downloads. Those sets need a license pass and a model call per item. The cases here are the policy, sandbox, invoice, and retrieval checks that have to pass on every pull request.
