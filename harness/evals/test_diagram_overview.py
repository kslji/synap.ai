#!/usr/bin/env python3
"""Diagram + file overview must stay extractive (not LLM) for light models.

Light tags (Qwen 2.5 1.5B, llama 1B) invent bad mermaid / dump the wrong file.
Pack + LocalChat must early-exit to architectureFlowFromFiles / extractiveFileOverview.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
GROUNDED = ROOT / "apps" / "web" / "src" / "lib" / "groundedContext.ts"
LOCAL_CHAT = ROOT / "apps" / "web" / "src" / "components" / "LocalChat.tsx"
PACK_HTML = ROOT / "apps" / "web" / "public" / "local-agent.html"
CSS = ROOT / "apps" / "web" / "src" / "app" / "globals.css"
MERMAID_FLOW = ROOT / "apps" / "web" / "src" / "lib" / "mermaidFlow.ts"
MERMAID_COMP = ROOT / "apps" / "web" / "src" / "components" / "MermaidFlow.tsx"


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    grounded = GROUNDED.read_text(encoding="utf-8")
    chat = LOCAL_CHAT.read_text(encoding="utf-8")
    html = PACK_HTML.read_text(encoding="utf-8")
    css = CSS.read_text(encoding="utf-8")
    mf = MERMAID_FLOW.read_text(encoding="utf-8")
    mc = MERMAID_COMP.read_text(encoding="utf-8")

    check(
        "wants-diagram-export",
        "export function wantsDiagram" in grounded,
        "groundedContext exports wantsDiagram",
        rows,
    )
    check(
        "architecture-flow-export",
        "export function architectureFlowFromFiles" in grounded
        and "documentStructureFlow" in grounded,
        "zip tree + document section fallback",
        rows,
    )
    check(
        "overview-excludes-diagram",
        "if (wantsDiagram(q)) return false" in grounded,
        "wantsFileOverview must not steal diagram asks",
        rows,
    )
    check(
        "light-model-tags",
        "qwen2\\.5:1\\.5" in grounded and "1\\.5b" in grounded,
        "isLightModelTag covers Qwen 1.5B",
        rows,
    )
    check(
        "localchat-diagram-early-exit",
        "wantsDiagram(asked)" in chat and "architectureFlowFromFiles(named)" in chat,
        "LocalChat builds diagram before LLM",
        rows,
    )
    check(
        "localchat-overview-always-extractive",
        "wantsFileOverview(asked)" in chat
        and "extractiveFileOverview(named)" in chat
        and "always extractive" in chat.lower(),
        "file overview never LLM'd when attachments exist",
        rows,
    )
    check(
        "pack-wants-diagram",
        "function wantsDiagram(q)" in html and "architectureFlowFromFiles" in html,
        "pack has diagram helpers",
        rows,
    )
    check(
        "pack-diagram-early-exit",
        "wantsDiagram(asked)" in html
        and "architectureFlowFromFiles(named.length ? named : t.attached)" in html,
        "pack send() early-exits for diagrams",
        rows,
    )
    check(
        "pack-overview-always-extractive",
        "wantsFileOverview(asked) && !wantsDiagram(asked)" in html
        and "extractiveFileOverview" in html,
        "pack summaries skip light-model LLM path",
        rows,
    )
    check(
        "pack-overview-ask-excludes-diagram",
        "const overviewAsk" in html
        and "&& !/\\b(mermaid|flowchart|diagram|visuali[sz]e)\\b/.test(q)" in html,
        "retrieveFiles overviewAsk does not dump-all for diagram",
        rows,
    )
    check(
        "pack-mermaid-html",
        "function mermaidHtml" in html and 'lang === "mermaid"' in html,
        "pack renders mermaid blocks as flow-map",
        rows,
    )
    check(
        "composer-min-width-0",
        "min-width: 0" in css and "composer-box textarea" in css,
        "query bar textarea can shrink in flex",
        rows,
    )
    check(
        "pack-composer-min-width",
        ".composer-box textarea" in html and "min-width: 0" in html,
        "pack query bar flex-safe",
        rows,
    )
    check(
        "composer-grammarly-off",
        'data-gramm="false"' in chat and 'data-gramm="false"' in html,
        "Grammarly cannot inflate composer",
        rows,
    )
    check(
        "mermaid-parse-present",
        "export function parseMermaid" in mf and "layersFor" in mf,
        "React mermaid parser available",
        rows,
    )
    check(
        "mermaid-hub-collapse",
        "collapseHub" in mc or "cross.length > 1" in mc,
        "TB hub→children uses one connector",
        rows,
    )
    # Smoke: documentStructureFlow produces mermaid fence for a resume-like blob
    # (static check that section regexes still exist)
    check(
        "document-structure-sections",
        "professional|work)\\s+experience" in grounded
        or "technical\\s+skills" in grounded
        or "technical\\s+skills" in grounded.replace("\\\\", "\\"),
        "resume section detectors present",
        rows,
    )
    check(
        "pack-document-structure",
        "function documentStructureFlow" in html
        and "flowchart TB" in html,
        "pack can diagram a single resume/file",
        rows,
    )
    check(
        "hallucination-gate-export",
        "export function groundAttachedFileReply" in grounded
        and "export function looksUngroundedAgainstFiles" in grounded,
        "grounding gate exported from groundedContext",
        rows,
    )
    check(
        "localchat-hallucination-gate",
        "groundAttachedFileReply(" in chat,
        "LocalChat applies grounding after model reply",
        rows,
    )
    check(
        "pack-hallucination-gate",
        "function groundAttachedFileReply" in html
        and "groundAttachedFileReply(finalText" in html,
        "pack applies grounding after model reply",
        rows,
    )
    check(
        "no-invent-prompt",
        "Do not invent facts, filenames" in grounded
        or "do not invent facts, names, or paths" in grounded.lower()
        or "Never invent mermaid" in grounded,
        "system cue forbids inventing file facts",
        rows,
    )
    # Multi-category attachment Q&A (not résumé-only)
    check(
        "classify-attachment-kinds",
        'AttachmentKind' in grounded
        and 'export function classifyAttachment' in grounded
        and '"resume"' in grounded
        and '"zip"' in grounded
        and '"spreadsheet"' in grounded
        and '"outreach"' in grounded
        and '"slides"' in grounded
        and '"code"' in grounded
        and '"config"' in grounded
        and '"document"' in grounded,
        "classifyAttachment covers resume/zip/sheet/outreach/slides/code/config/doc",
        rows,
    )
    check(
        "interview-routes-by-kind",
        "export function extractiveInterviewQuestions" in grounded
        and 'kind === "resume"' in grounded
        and 'kind === "spreadsheet"' in grounded
        and 'kind === "outreach"' in grounded
        and 'kind === "slides"' in grounded
        and 'kind === "code"' in grounded
        and 'kind === "config"' in grounded
        and 'kind === "document"' in grounded
        and "extractiveDocumentQuestions" in grounded
        and "extractiveSpreadsheetQuestions" in grounded
        and "extractiveCodeQuestions" in grounded,
        "extractiveInterviewQuestions switches on attachment kind",
        rows,
    )
    check(
        "wants-questions-any-attachment",
        "file|zip|pdf|doc|document|project|repo|code|sheet|spreadsheet" in grounded
        and "file|zip|pdf|doc|document|project|repo|code|sheet|spreadsheet" in html,
        "wantsInterviewQuestions matches non-resume attachment phrasing",
        rows,
    )
    check(
        "localchat-interview-early-exit",
        "wantsInterviewQuestions(asked)" in chat and "extractiveInterviewQuestions(named" in chat,
        "LocalChat early-exits interview asks for any attached file",
        rows,
    )
    check(
        "pack-classify-and-interview",
        "function classifyAttachment(files)" in html
        and "function extractiveInterviewQuestions(files" in html
        and 'kind === "spreadsheet"' in html
        and "extractiveDocumentQuestions" in html
        and "extractiveSpreadsheetQuestions" in html
        and "extractiveCodeQuestions" in html
        and "wantsInterviewQuestions(asked)" in html,
        "pack mirrors category-aware interview path",
        rows,
    )
    check(
        "present-question-list",
        "export function presentQuestionList" in grounded
        and "export function formatNumberedQuestions" in grounded
        and "function presentQuestionList" in html
        and "function formatNumberedQuestions" in html
        and "always extractive numbered list" in html,
        "question lists formatted for every model",
        rows,
    )
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
