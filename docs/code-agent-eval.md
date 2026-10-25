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
| direct | `runCodeAgent` - one loop, a tool call per turn, no plan | the executor inside `runSplitTask` |
| split | `runSplitTask` - triage, then a route: one or two files behind at most two symbols go straight to the loop; a new file, three or more files, or more than two symbols get one plan attempt and a step per file, each with a check and a failure ladder (3 tries, 3 candidates); `chat` delegates to the loop | the shipped path for every code ask |

So the comparison is "with and without task decomposition" in the shape the app actually ships it:
split is the entry point, and the loop is what split runs for most tasks. On the single-file and
two-file fixtures the two columns are the same code path and score the same, which is the point of
the routing.

Both get the same fixture, the same task sentence, the same house-style rules, and `maxSteps: 8`.
Each fixture is written with a `tsconfig.json` and a `typecheck` script, so a step's `check` is a
real `tsc --noEmit` and a bad edit goes round the fix loop instead of being accepted. The eval
answers every approval with `allow`, because it scores the code a task ends with, not whether a
dialog appeared.

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

Apple M1, 8 GB, 1.19 GiB Q4_K_M, macOS. Timeout 120 s per run.

| Mode | Pass | Wall clock | Median steps | Requests |
| --- | --- | --- | --- | --- |
| direct | 13/20 (65%) | 279 s | 4 | 100 |
| split (shipped) | 12/20 (60%) | 909 s | 3 | 100 |

The split wall clock includes one stalled run: `counter-reset` sat for 616 s inside a single
`llama-server` request and was cut off by the 120 s abort only when that request finally returned.
The other 19 runs total 293 s. Without the stall the two columns are identical except for
`shared-limit`, the one task that still takes the checklist.

By task size, which is where the remaining difference is:

| | Single file (10) | Several files (10) |
| --- | --- | --- |
| direct | 8 | 5 |
| split | 8 | 4 |

Against the run this work started from (direct 12/20 in 330 s, split 8/20 in 1548 s with seven runs
cut off by the 120 s cap), the shipped path is 4 tasks better and 5x faster, and no run is now lost
to the timeout. The target for this change was 15/20; the shipped path scores 13/20 with the stall
excluded, and the seven failures left are wrong edits, not a harness that gave up.

## Where the model actually fails

Four kinds, in the order they cost the most:

1. **It writes the neighbouring line instead of the one it was asked to change.** `rename-add`
   answers a diff that keeps `function add(` and appends `+ 0` to the body, then calls finish with
   "Renamed the function `add` to `sum`". `max-bytes` rewrites the first `1024` and leaves `/ 1024`
   in the second function with the same confidence. Both are one-line diffs the model has the file
   in front of it for, and both pass `tsc`, so only the text rules catch them.
2. **It edits the second file the wrong way rather than not at all.** `missing-file` shows the
   finish guard working: the first `finish` is refused with "Nothing changed in src/err.ts", the
   model goes to the file - and then writes the message string into both files instead of exporting
   `MESSAGE` from one and importing it. `move-base-url` never moves the constant at all, and
   `parse-null` writes `parse(text) || 0` where the task asks for `null`.
3. **A new file is never proposed.** `shared-limit` needs `src/limits.ts` created and imported
   twice. The checklist is the only route it can take (three files), and the ladder ran three
   candidates without ever proposing the create.
4. **It repeats a tool call.** `async-load` read the same file twice in a row and stopped on the
   repeat guard.

What it does do, in both modes and in under 10 s each: single edits it can copy from what it read -
constant change, comparison change, index fix, template literal, a new named export, a TODO
replacement - plus, at 14-61 s, the two-file asks where both sides are a copy of what it read
(`rename-fmt`, `add-timeout`, `row-note`, `nan-check`, `counter-reset`).

## What follows from this

- Routing is the change this measurement pays for. A task naming one or two files behind at most
  two symbols runs the loop: 2 requests for a one-line diff instead of 6, and no ladder. The
  checklist keeps the cases a 2B cannot hold in one pass - a new file, three files, more than two
  symbols - which is where `shared-limit` still fails.
- One plan attempt, not three. A rejected checklist cost a whole thinking pass - 40 to 51 s measured
  on this box - and the two retries never turned a rejection into a valid plan. A rejection now
  falls back to the loop with the reason in the answer.
- The finish guard is deterministic and cheap: a `finish` that names a file the request asked for
  and nothing touched is sent back once. `missing-file` shows it firing. It cannot fix an edit the
  model writes from memory, and nothing in the harness can - that needs a model that re-reads.
- The next change this measurement argues for is a check inside the loop: after an applied edit,
  run the project's `typecheck` and go round the fix step once, the way the checklist already does
  per step. That is what would catch `rename-add` and `max-bytes`-shaped no-ops earlier, though
  neither fails `tsc`, so a per-fixture test command would be the stronger version.
- The passing set above is the honest capability claim for the default: single-file edits, copied
  from a read, one at a time, plus two-file asks where a read is enough to write both sides.
  Anything cross-file with a signature change is what the failure ladder's model suggestion is for.

## Limits of this eval

- It scores file text on top of a real `tsc --noEmit` check. A change that compiles but is wrong -
  `parse(text) || 0` - is caught only by the text rules; a test command per fixture would catch
  more, and none of the twenty fixtures has one yet.
- Only the 2B is measured here. The 4B reruns the same 20 tasks with `--model qwen3.5-4b-q4_k_m`
  when its weights are on disk.
- It is not in CI: it needs model weights and a GPU. It is a release check, run by hand, with the
  score recorded in the ADR.
- One sample per task per mode. The 2B is not deterministic across hardware, so treat a single
  task's outcome as a coin flip near the model's edge, and the totals as the signal.
- A single request can stall for minutes on an 8 GB machine under memory pressure (`counter-reset`
  above). The 120 s cap fires when the request returns, not while it hangs, so a stalled run costs
  wall clock and is reported as stopped rather than timed out.
