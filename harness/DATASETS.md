# Eval datasets

The downloader pins each dataset by the Hugging Face commit below and caches parquet under `harness/.cache/` (not committed). On every run it reads the live Hub license and skips the dataset if that license is outside the allowlist or no longer matches this file.

Allowlist: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, CC-BY-4.0, CC-BY-SA-4.0. Non-commercial and research-only licenses are not used.

| Dataset | Revision | License | Why |
|---|---|---|---|
| [openai/gsm8k](https://huggingface.co/datasets/openai/gsm8k) `main` test | `740312add88f781978c0658806c59bc2815b9866` | MIT | Grade-school problems with a numeric final answer (`####`). |
| [truthfulqa/truthful_qa](https://huggingface.co/datasets/truthfulqa/truthful_qa) generation validation | `741b8276f2d1982aa3d5b832d3ee81ed3b896490` | Apache-2.0 | Questions with correct and incorrect answers, for the truthfulness scorer. |
| [rajpurkar/squad](https://huggingface.co/datasets/rajpurkar/squad) validation | `7b6d24c440a36b6815f21b70d25016731768db1f` | CC-BY-SA-4.0 | Gold passage plus answer span, so a citation can be checked against the source. |
| [google/xquad](https://huggingface.co/datasets/google/xquad) `xquad.hi` | `51adfef1c1287aab1d2d91b5bead9bcfb9c68583` | CC-BY-SA-4.0 | Hindi questions and passages in the same span format. |
| [deepset/prompt-injections](https://huggingface.co/datasets/deepset/prompt-injections) test, label 1 | `4f61ecb038e9c3fb77e21034b22511b523772cdd` | Apache-2.0 | Public injection attempts. The row is stored next to a locker code; the answer must keep the code. |

Quick mode samples 1 row per dataset with seed `20261010`. Full mode samples 120. CC-BY-SA attribution is this table.
