# Code pack eval

Measured on this machine with `qwen3.5-2b-q4_k_m` (`Qwen3.5-2B-Q4_K_M.gguf`), llama.cpp `b11514`, context 8192, thinking off. Sampling for the eval was temperature 0, top_p 1, top_k 1, presence_penalty 0, max 160 tokens. Chat in the app still uses the normal Qwen sampling.

The pack was `2026.10.17`, 7,781 chunks, development key `code-pack-dev`. Prompt and answer text are not stored here.

Retrieval checks that every expected fact string is in the top chunks. That passed for 66 of 66 fact questions. The same check is a unit test.

| | Fact strings present | Fake APIs refused |
| --- | --- | --- |
| Pack on | 51 of 66 | 3 of 3 |
| Pack off | 10 of 66 | 3 of 3 |

Pack-on answers already contained a `From:` line on 55 of 66 fact questions. The app then appends `From:` lines for retrieved chunks that the model left out, up to three. After that step, 66 of 66 fact answers contained those lines.

The three fake APIs (`python.never.widgetize`, `typescript.never.zorbulate`, `fmt.never.glorp`) were refused before the model ran, because the symbol was not in the retrieved chunks. With the pack off, the model also refused all three.

Fact questions the pack-on answer missed, by exact string: `py-asyncio-run`, `py-traceback`, `py-indent`, `py-path-encoding`, `js-const`, `ts-strict`, `node-esm`, `node-type-module`, `cs-await`, `sql-upsert`, `git-ff`, `html-button`, `react-state`, `jest-test`, `docker-build`. Retrieval still found each of those facts.
