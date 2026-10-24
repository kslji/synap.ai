# The 20-task agent eval

Does the default model, Qwen3.5-2B, actually finish the edits people ask for, and does splitting a
task into steps help? This eval answers both with one number each, on the real model, through the
real code paths.

    npm run eval:agent                      # 20 tasks, direct and split, the 2B default
    npm run eval:agent -- --mode split      # one mode
    npm run eval:agent -- --only rename-add,max-bytes
    npm run eval:agent -- --timeout 300 --json /tmp/agent-eval.json
    npm run eval:agent -- --model qwen3.5-4b-q4_k_m
    npm run eval:agent -- --model-file ~/models/Qwen3.5-4B-Q4_K_M.gguf --verbose

It starts `llama-server` the way the app starts it (same binary, context 8192, GPU layers on) and
runs the same provider stack, so a pass here is a pass in the app. Deterministic sampling
(`EVAL_SAMPLING`) means a rerun scores the same way.

## The two modes

| Mode | What runs | What the app does |
| --- | --- | --- |
| direct | `runCodeAgent` - one loop, a tool call per turn, no plan | used for tasks triaged as `chat` |
| split | `runSplitTask` - triage, then one step for an `edit` or a plan for a `plan`, each step with checks and a failure ladder (3 tries, 3 candidates); `chat` delegates to the loop | the shipped path for every code ask |

So the comparison is exactly "with and without task decomposition", but split is not a special
mode: it is the path the app takes, and direct is the loop it falls back to when triage says the
task is a question rather than an edit.

Both get the same fixture, the same task sentence, the same house-style rules, and `maxSteps: 8`.
The eval answers every approval with `allow` and every command with `ok`, because it scores the
code a task ends with, not whether a dialog appeared.

## The tasks

Ten single-file and ten multi-file, all throwaway fixtures:

| Task | Files | Asks for |
| --- | --- | --- |
| rename-add | 1 | rename `add` to `sum` |
| retries-five | 1 | change a constant 3 to 5 |
| divide-guard | 1 | return 0 for a zero divisor |
| greet-template | 1 | concatenation to a template literal |
| log-prefix | 1 | an optional parameter on an existing function |
| max-bytes | 1 | lift two magic numbers into one constant |
| strict-eq | 1 | `==` to `===` |
| first-item | 1 | fix a wrong index |
| export-version | 1 | add a named export beside a default |
| todo-comment | 1 | replace a TODO with a sentence |
| rename-fmt | 2 | rename a function and its caller |
| add-timeout | 2 | add a parameter and pass it at the call site |
| move-base-url | 2 | move a constant to another file and import it back |
| parse-null | 2 | return null, and handle null at the caller |
| shared-limit | 3 | create one shared file, import it in two others |
| row-note | 2 | widen an interface and use the new field |
| async-load | 2 | make a function async and await it |
| nan-check | 2 | widen a guard and change a message |
| missing-file | 2 | share a message constant between two files |
| counter-reset | 2 | add a function and call it before use |

## Scoring

`scoreFiles` in `src/main/core/code-agent/eval-cases.ts` reads each checked file after the run. A
run passes when every rule holds - the file exists, contains what it must, no longer contains what
it must not - and the run stopped on `finish`. A run that stops on a repeat, a rejection, or the
timeout cap fails even if the code looks right, because a person would have been left waiting.

The tasks and the scorer are data plus one pure function, so `eval-cases.test.ts` checks the eval
itself with no model: no fixture may already satisfy its own rule, every "must not contain" string
must be in the fixture (or it could never fail), every scored path must be real, and the 2B's
answer-shaped no-op edit (`return a + b + 0`) must not score.

## Results on Qwen3.5-2B

Apple M1, 8 GB, 1.19 GiB Q4_K_M, macOS. Timeout 120 s per run unless noted.

| Mode | Pass | Wall clock | Median steps |
| --- | --- | --- | --- |
| direct | 12/20 (60%) | 330 s | 4 |
| split | 8/20 (40%) | 1548 s | 2 |

By task size, which is where the difference is:

| | Single file (10) | Several files (10) |
| --- | --- | --- |
| direct | 8 | 4 |
| split | 7 | 1 |

The two modes agree on the single-file tasks the 2B can do by copying what it read, and part ways
on everything else. Decomposition turns 4 of 10 multi-file passes into 1.

Direct is both more accurate and 4.7x faster. It stops on `finish` in 19 of 20 runs and only once
on a repeated tool call; its eight failures are wrong code, not stalled loops.
Split's twelve failures fall into two kinds. Five never produced a valid plan: `runSplitTask`
returned `failed` with 0-2 steps for `retries-five`, `max-bytes`, `move-base-url`, `parse-null` and
`shared-limit` - the plan validator rejects steps whose files do not match the triage, and the 2B
keeps proposing a step for a file it was not allowed to touch. Seven others were cut off by the
120 s cap, which the ladder can reach on its own: three attempts times three candidates on a 2B is
minutes, not seconds. The cost shows up even on the single-file asks it does pass: `rename-add` is
2 requests through the loop and 6 through the ladder, for the same one-line diff.

Renaming that cap and rerunning those seven at 300 s:

| Task | At 300 s | What happened |
| --- | --- | --- |
| todo-comment | FAIL, 128 s | stopped after one step; the TODO line never changed |
| rename-fmt | FAIL, 300 s | hit the cap: 4 steps, 11 requests, the caller still calls `fmt` |
| add-timeout | FAIL, 300 s | hit the cap: 3 steps, 12 requests, `api.ts` never gained the parameter |
| row-note | FAIL, 300 s | hit the cap: 2 steps, 10 requests, the interface was never widened |
| async-load | FAIL, 300 s | hit the cap: 2 steps, 10 requests, `load` never became async |
| missing-file | FAIL, 243 s | ran its tries and stopped; the message never changed |
| counter-reset | FAIL, 300 s | hit the cap: 2 steps, 13 requests, `reset` never appeared |

None passed. The timeout is not what makes split lose: given five times the time, two of the seven
ran to their own end with the file unchanged, and the other five hit the cap again. The 120 s cap
only made the report finish.

## Where the model actually fails

Four kinds, in the order they cost the most:

1. **It does not finish an edit it has already read.** `max-bytes` direct asks for two `1024`s to
   become `MAX_BYTES`; the model emitted a diff for the first line, then answered with prose. The
   file still held `/ 1024`.
2. **It writes a whole file from memory instead of a patch.** `rename-add` direct replaced
   `function add(` with `return a + b + 0` - the body it remembered, not the line it was editing -
   and reported success.
3. **Coordinated change across two files is beyond it.** Every multi-file task that needs a
   signature change plus a call-site change (`add-timeout`, `async-load`, `missing-file`,
   `parse-null`) failed in both modes, usually with one side edited and the other untouched.
4. **A new file is never proposed.** `shared-limit` needs `src/limits.ts` created and imported
   twice. Both paths can create one - `propose_edit` on a path that does not exist writes it - but
   the 2B proposed `src/limits.ts` in neither mode, and in split the planner kept naming a file it
   was not allowed to touch, which the validator rejected.

What it does do, in both modes and in under 10 s: single edits it can copy from what it read -
rename, constant change, comparison change, index fix, template literal, a new named export.

## What follows from this

- The next change this measurement argues for is routing a task triaged as `edit` straight to the
  loop instead of wrapping it in a one-step ladder. That is 8 of 10 single-file passes instead of
  7, and 2 requests for a one-line diff instead of 6. It needs its own golden test before it ships.
- The passing set above is the honest capability claim for the default: single-file edits, copied
  from a read, one at a time. Anything cross-file is what the failure ladder's model suggestion is
  for.
- Split's plan validator is doing real work: five of its twelve failures were caught at plan time
  rather than by writing the wrong files.

## Limits of this eval

- It scores file text, not behaviour. The fixtures have no test command, so a step's check
  resolves to nothing and the ladder cannot catch a change that compiles but is wrong. Adding a
  per-fixture `tsc` check would raise both scores and make them mean more.
- Only the 2B is measured here. The 4B reruns the same 20 tasks with `--model qwen3.5-4b-q4_k_m`
  when its weights are on disk.
- It is not in CI: it needs model weights and a GPU. It is a release check, run by hand, with the
  score recorded in the ADR.
- One sample per task per mode. The 2B is not deterministic across hardware, so treat a single
  task's outcome as a coin flip near the model's edge, and the totals as the signal.
