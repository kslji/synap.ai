#!/usr/bin/env python3
"""Run the shared eval against the desktop orchestrator.

Quick is the PR gate (hand-written cases, one seeded row per dataset, Qwen3.5-2B).
Full is the weekly / laptop run (about 120 rows per dataset).
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "harness"))
sys.path.insert(0, str(ROOT / "harness" / "evals"))

from core.datasets import cases_for  # noqa: E402
from core.documents import score_documents  # noqa: E402
from core.report import apply_thresholds, suite_rows, write_report  # noqa: E402
from core.scorers import score_case  # noqa: E402
from gate import compare_eval  # noqa: E402

import yaml  # noqa: E402


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def materialize_fixtures(dest: Path) -> None:
    src = ROOT / "harness" / "suites" / "shared" / "fixtures"
    dest.mkdir(parents=True, exist_ok=True)
    for path in src.iterdir():
        if path.is_file():
            (dest / path.name).write_bytes(path.read_bytes())
    sentence = "The spare lamp locker is painted grey and sits beside the coil rack. "
    text = "The spare lamp code is PL-17. Keep this code on the dock clipboard.\n\n" + sentence * 90
    (dest / "spare-lamp.txt").write_text(text, encoding="utf-8")


def thresholds_for(mode: str) -> dict:
    raw = yaml.safe_load((ROOT / "harness" / "suites" / "shared" / "thresholds.yaml").read_text(encoding="utf-8"))
    block = raw.get(mode) or raw
    return {"regression_tolerance": block.get("regression_tolerance", 0.05), "suites": block.get("suites") or {}}


def run_electron(cases: list[dict], work: Path, phase: str, mode: str) -> dict:
    cases_path = work / f"cases-{phase}.json"
    out_path = work / f"out-{phase}.json"
    user = work / f"userdata-{phase}"
    user.mkdir(parents=True, exist_ok=True)
    cases_path.write_text(json.dumps(cases), encoding="utf-8")
    env = os.environ.copy()
    env.update({
        "SURF_EVAL": "1",
        "SURF_EVAL_DIR": str(user),
        "SURF_EVAL_CASES": str(cases_path),
        "SURF_EVAL_OUT": str(out_path),
        "SURF_EVAL_FIXTURES": str(work / "fixtures"),
        "SURF_EVAL_DB_KEY": os.urandom(32).hex(),
        "SURF_EVAL_REPORT": str(ROOT / "harness" / "reports" / "latest.json"),
        "SURF_EVAL_CHAT_MODEL": env.get("SURF_EVAL_CHAT_MODEL", "qwen3.5-2b-q4_k_m"),
        "SURF_EVAL_FORCE_ONLINE": "1",
        "SURF_EVAL_METRICS": mode,
        "SURF_MODELS_DIR": env.get("SURF_MODELS_DIR", str(Path.home() / "surf-models")),
        "DISPLAY": env.get("DISPLAY", ":1"),
    })
    if phase == "2":
        env["SURF_EVAL_SKIP_METRICS"] = "1"
    log_path = work / f"electron-{phase}.log"
    timeout = 3600 if mode == "quick" else 6 * 3600
    with log_path.open("w", encoding="utf-8") as log:
        proc = subprocess.Popen(
            ["npm", "run", "eval:electron", "-w", "@surf/desktop"],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            raise SystemExit(f"electron eval timed out; see {log_path}")
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGTERM)
    if not out_path.exists():
        tail = log_path.read_text(encoding="utf-8")[-4000:]
        raise SystemExit(f"electron exited {code} without a transcript\n{tail}")
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    if code != 0 and not payload.get("cases"):
        tail = log_path.read_text(encoding="utf-8")[-4000:]
        raise SystemExit(f"electron exited {code}\n{tail}")
    return payload


def run_documents() -> list[dict]:
    proc = subprocess.run(
        ["npx", "tsx", "src/main/core/document-suite.ts"],
        cwd=ROOT / "apps" / "desktop",
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit((proc.stderr or proc.stdout)[-2000:])
    try:
        return score_documents(json.loads(proc.stdout))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"document suite did not return JSON ({exc})\n{proc.stdout[-500:]}") from exc


def score_transcripts(cases: list[dict], payload: dict) -> list[dict]:
    by_id = {item["id"]: item for item in payload.get("cases") or []}
    return [score_case(case, by_id.get(case["id"])) for case in cases]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("quick", "full"), default="quick")
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args()
    started = time.time()
    work = ROOT / "harness" / ".cache" / "run"
    if work.exists():
        for child in work.iterdir():
            if child.is_dir():
                subprocess.run(["rm", "-rf", str(child)], check=False)
            elif child.is_file():
                child.unlink()
    work.mkdir(parents=True, exist_ok=True)
    materialize_fixtures(work / "fixtures")
    shared = load_jsonl(ROOT / "harness" / "suites" / "shared" / "cases.jsonl")
    hf_cases, dataset_records = cases_for(args.mode)
    cases = shared + hf_cases
    phase1 = [case for case in cases if case.get("phase") != 2]
    phase2 = [case for case in cases if case.get("phase") == 2]
    thresholds = thresholds_for(args.mode)
    print(f"eval {args.mode}: document suite, then {len(phase1)} cases then {len(phase2)} pack cases", flush=True)
    document_scored = run_documents()
    print(f"documents {sum(1 for row in document_scored if row['ok'])}/{len(document_scored)}", flush=True)
    first = run_electron(phase1, work, "1", args.mode)
    scored = document_scored + score_transcripts(phase1, first)
    suites = suite_rows(scored)
    apply_thresholds(suites, thresholds)
    reports = ROOT / "harness" / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "latest.json").write_text(json.dumps({"ok": all(item.get("ok") for item in suites.values()), "mode": args.mode, "suites": suites}, indent=2) + "\n", encoding="utf-8")
    transcripts = list(first.get("cases") or [])
    models = first.get("models") or []
    if phase2:
        if suites.get("shared", {}).get("ok"):
            second = run_electron(phase2, work, "2", args.mode)
            scored.extend(score_transcripts(phase2, second))
            transcripts.extend(second.get("cases") or [])
            suites = suite_rows(scored)
            apply_thresholds(suites, thresholds)
        else:
            for case in phase2:
                scored.append({"id": case["id"], "suite": case["suite"], "weight": case.get("weight") or 1, "ok": False, "reasons": ["blocked: shared suite below the floor"]})
            suites = suite_rows(scored)
            apply_thresholds(suites, thresholds)
    baseline_path = ROOT / "harness" / "baselines" / f"{args.mode}.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8")) if baseline_path.exists() else None
    diffs = compare_eval({"suites": suites}, thresholds, baseline if not args.write_baseline else None)
    floor_failures = [row for row in diffs if row["id"].endswith("-threshold") and not row["ok"]]
    regressions = [row for row in diffs if not row["ok"] and not row["id"].endswith("-threshold")]
    ok = not floor_failures and not regressions and all(item.get("ok") for item in suites.values() if item["cases"])
    # A suite can be under its floor even when compare marks the threshold.
    if any(not entry.get("ok") for entry in suites.values()):
        ok = False
    report = {
        "ok": ok,
        "mode": args.mode,
        "chat_model": os.environ.get("SURF_EVAL_CHAT_MODEL", "qwen3.5-2b-q4_k_m"),
        "elapsed_s": round(time.time() - started, 1),
        "suites": suites,
        "scored": scored,
        "transcripts": transcripts,
        "models": models,
        "datasets": dataset_records,
        "diffs": diffs,
    }
    paths = write_report(reports, report)
    print(paths["md"].read_text(encoding="utf-8"))
    if args.write_baseline and ok:
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(json.dumps({"mode": args.mode, "chat_model": report["chat_model"], "suites": suites}, indent=2) + "\n", encoding="utf-8")
        print("WROTE", baseline_path)
    elif args.write_baseline:
        print("baseline not written; the run did not pass")
    if args.mode == "quick" and baseline is None and not args.write_baseline:
        print("quick baseline missing; run with --write-baseline after a good local run")
        return 1
    return 0 if ok or (args.mode == "full" and baseline is None and not floor_failures) else 1


if __name__ == "__main__":
    sys.exit(main())
