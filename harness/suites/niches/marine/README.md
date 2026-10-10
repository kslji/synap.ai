# Marine suite

This folder is the empty niche template. Add JSONL cases here when the Marine agent has its own documents and thresholds. Until `cases.jsonl` has rows, the pack signer uses the shared suite result.

## Add a case

One JSON object per line:

```json
{"id":"tide-board","suite":"marine","weight":3,"turns":[{"question":"When is the tide board updated?","offlineOnly":true,"documents":["tide-board.txt"],"expect":{"contains":["06:00"],"citation":true,"source_contains":["06:00"]}}]}
```

Put fixture files next to the JSONL or under `fixtures/`. `weight` is the severity: safety and grounding stay higher than style.

## Thresholds

`thresholds.yaml` holds `min_score` and `regression_tolerance` for this niche. The runner gates a niche on its own rows once the report lists `cases` greater than zero. A score under `min_score`, or a drop larger than the tolerance from `harness/baselines/`, blocks the pack signature for `--niche marine`.

Wire the new suite into `harness/core/run_eval.py` by loading this JSONL next to the shared file, then re-run `python3 harness/core/run_eval.py --mode quick --write-baseline` only after the scores are the ones you want to keep.
