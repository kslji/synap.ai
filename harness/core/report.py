"""JSON, Markdown, and HTML reports."""
from __future__ import annotations

import html
import json
from pathlib import Path


def suite_rows(scored: list[dict]) -> dict[str, dict]:
    grouped: dict[str, list[dict]] = {}
    for row in scored:
        grouped.setdefault(str(row["suite"]), []).append(row)
    suites = {}
    for name, rows in grouped.items():
        total = sum(float(row["weight"]) for row in rows) or 1
        passed = sum(float(row["weight"]) for row in rows if row["ok"])
        score = passed / total
        suites[name] = {
            "score": round(score, 4),
            "cases": len(rows),
            "passed": sum(1 for row in rows if row["ok"]),
            "weight": total,
            "passed_weight": passed,
        }
    return suites


def apply_thresholds(suites: dict, thresholds: dict) -> None:
    spec = thresholds.get("suites") or {}
    for name, entry in suites.items():
        minimum = float((spec.get(name) or {}).get("min_score", 0))
        entry["min_score"] = minimum
        entry["ok"] = entry["cases"] > 0 and float(entry["score"]) + 1e-9 >= minimum


def markdown(report: dict) -> str:
    lines = [
        f"# Surf eval ({report.get('mode')})",
        "",
        f"Model `{report.get('chat_model')}`. Ok: **{report.get('ok')}**.",
        "",
        "| Suite | Score | Passed | Floor |",
        "|---|---:|---:|---:|",
    ]
    for name, entry in (report.get("suites") or {}).items():
        lines.append(f"| {name} | {entry['score']:.3f} | {entry['passed']}/{entry['cases']} | {entry.get('min_score', 0):.2f} |")
    lines += ["", "## Models", ""]
    for model in report.get("models") or []:
        if model.get("present"):
            lines.append(f"- {model['id']}: {model.get('latencyMs')} ms, RSS {model.get('rssMb')} MB. {model.get('note') or ''}")
        else:
            lines.append(f"- {model['id']}: not measured. {model.get('note') or 'not installed'}")
    diffs = report.get("diffs") or []
    if diffs:
        lines += ["", "## Baseline", ""]
        for row in diffs:
            mark = "PASS" if row["ok"] else "FAIL"
            lines.append(f"- {mark} {row['id']}: {row['detail']}")
    fails = [row for row in report.get("scored") or [] if not row["ok"]]
    if fails:
        lines += ["", "## Failures", ""]
        transcripts = {item["id"]: item for item in report.get("transcripts") or []}
        for row in fails:
            lines.append(f"### {row['id']}")
            for reason in row["reasons"]:
                lines.append(f"- {reason}")
            transcript = transcripts.get(row["id"]) or {}
            for turn in transcript.get("turns") or []:
                answer = str(turn.get("answer") or turn.get("error") or "")[:800]
                lines.append("")
                lines.append("```")
                lines.append(answer)
                lines.append("```")
    return "\n".join(lines) + "\n"


def html_report(report: dict) -> str:
    suites = report.get("suites") or {}
    bars = []
    for name, entry in suites.items():
        width = max(0, min(100, int(float(entry["score"]) * 100)))
        bars.append(
            f"<tr><td>{html.escape(name)}</td>"
            f"<td><div class='bar'><span style='width:{width}%'></span></div> {entry['score']:.3f}</td>"
            f"<td>{entry['passed']}/{entry['cases']}</td>"
            f"<td>{'pass' if entry.get('ok') else 'fail'}</td></tr>"
        )
    models = []
    for model in report.get("models") or []:
        if model.get("present"):
            models.append(f"<li><b>{html.escape(model['id'])}</b> {model.get('latencyMs')} ms, {model.get('rssMb')} MB RSS</li>")
        else:
            models.append(f"<li><b>{html.escape(model['id'])}</b> skipped. {html.escape(str(model.get('note') or ''))}</li>")
    fails = []
    transcripts = {item["id"]: item for item in report.get("transcripts") or []}
    for row in report.get("scored") or []:
        if row["ok"]:
            continue
        turns = transcripts.get(row["id"], {}).get("turns") or []
        body = "<br>".join(html.escape(reason) for reason in row["reasons"])
        answer = ""
        if turns:
            answer = html.escape(str(turns[-1].get("answer") or "")[:700])
        fails.append(f"<section><h3>{html.escape(str(row['id']))}</h3><p>{body}</p><pre>{answer}</pre></section>")
    diffs = "".join(
        f"<li>{'PASS' if row['ok'] else 'FAIL'} {html.escape(row['id'])}: {html.escape(row['detail'])}</li>"
        for row in report.get("diffs") or []
    )
    status = "passed" if report.get("ok") else "failed"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Surf eval {html.escape(str(report.get('mode')))}</title>
<style>
  body {{ margin: 0; background: #fafafa; color: #111; font: 15px/1.45 "Iowan Old Style", Georgia, serif; }}
  main {{ max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }}
  h1 {{ font-weight: 560; letter-spacing: -0.03em; }}
  .status {{ display: inline-block; background: #111; color: #fff; border-radius: 999px; padding: 2px 10px; font: 12px/1.6 ui-sans-serif, sans-serif; }}
  table {{ width: 100%; border-collapse: collapse; background: #fff; }}
  td {{ border-top: 1px solid #eee; padding: 8px 6px; vertical-align: middle; }}
  .bar {{ display: inline-block; width: 140px; height: 8px; background: #eee; border-radius: 99px; vertical-align: middle; }}
  .bar span {{ display: block; height: 8px; background: #F97316; border-radius: 99px; }}
  pre {{ white-space: pre-wrap; background: #fff; padding: 12px; border: 1px solid #eee; }}
</style></head><body><main>
<h1>Surf evaluation <span class="status">{status}</span></h1>
<p>{html.escape(str(report.get('chat_model')))} · {html.escape(str(report.get('mode')))}</p>
<table>{''.join(bars)}</table>
<h2>Models</h2>
<ul>{''.join(models)}</ul>
<h2>Baseline</h2>
<ul>{diffs or '<li>No baseline diff.</li>'}</ul>
<h2>Failures</h2>
{''.join(fails) or '<p>None.</p>'}
</main></body></html>
"""


def write_report(directory: Path, report: dict) -> dict[str, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    json_path = directory / "report.json"
    md_path = directory / "report.md"
    html_path = directory / "report.html"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(markdown(report), encoding="utf-8")
    html_path.write_text(html_report(report), encoding="utf-8")
    latest = directory / "latest.json"
    latest.write_text(json.dumps({"ok": report["ok"], "mode": report["mode"], "suites": report["suites"]}, indent=2) + "\n", encoding="utf-8")
    return {"json": json_path, "md": md_path, "html": html_path, "latest": latest}
