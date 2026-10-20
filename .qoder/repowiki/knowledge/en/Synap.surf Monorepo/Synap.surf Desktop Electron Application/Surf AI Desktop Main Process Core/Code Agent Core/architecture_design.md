Two cooperating sub-systems share the same main-process context:
- `completion/` is a self-contained inline-completion pipeline (debounce → FIM prompt builder → llama.cpp HTTP client → cancellable response) with its own cache, snippet registry, policy, and Windows-specific helpers.
- The sibling files (`loop.ts`, `edit.ts`, `fix-loop.ts`, `tools.ts`, `sandbox.ts`, `checkpoint.ts`, `budget.ts`, `grammar.ts`, `plan.ts`, `project-search.ts`, `workspace.ts`, etc.) implement the higher-level agent: planning edits, spawning tools in a sandbox, applying patches, enforcing budgets and permissions, and coordinating with the editor via IPC.

Cross-child wiring points:
- `llama.ts` and `llama-complete.ts` provide the shared llama.cpp server interface consumed by both the completion pipeline and the agent's model selection (`suggest-model.ts`).
- `mode-store.ts`, `permission.ts`, and `system-rules.ts` are shared state/config surfaces read by both the completion pipeline and the agent loop.
- `windows-job.ts` and `dev-web-hook.ts` are platform/dev hooks used by both subsystems to integrate with the desktop shell.
- `diagnostics.ts`, `patch.ts`, `split.ts`, and `parse-tool.ts` are utilities reused across edit/fix-loop and completion flows.
The directory itself contains no entry point; it is imported by the parent `core/` bootstrap which instantiates the agent loop and registers the completion service.