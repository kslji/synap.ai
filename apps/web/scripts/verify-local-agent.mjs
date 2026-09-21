/**
 * Guardrails for downloaded packs (local-agent.html).
 * Run: node scripts/verify-local-agent.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "public/local-agent.html"), "utf8");

const checks = [];
function ok(id, pass, detail = "") {
  checks.push({ id, ok: !!pass, detail });
  const mark = pass ? "ok " : "FAIL";
  console.log(`${mark}  ${id}${detail ? " — " + detail : ""}`);
}

ok(
  "standalone-hides-light-note-css",
  /html\.standalone #light-note/.test(html),
  "CSS must hide #light-note in pack chat",
);

ok(
  "paint-hides-light-note-standalone",
  /if \(isStandalone\(\)\) \{\s*lightNote\.hidden = true;/.test(html),
  "paintEngines must force-hide light note in packs",
);

ok(
  "no-standalone-upsell-copy",
  !/isStandalone\(\)[\s\S]{0,200}Answers stay short on light models/.test(html),
  "must not set synap.surf upsell text for standalone packs",
);

ok(
  "summarize-button-wired",
  /getElementById\("summarize-side"\)\.onclick\s*=\s*\(\)\s*=>\s*compact\(\)/.test(html),
  "sidebar summarize must call compact()",
);

ok(
  "erase-button-wired",
  /getElementById\("erase-side"\)\.onclick\s*=\s*\(\)\s*=>\s*wipe\(\)/.test(html),
  "sidebar erase must call wipe()",
);

ok(
  "compact-waits-for-ollama-standalone",
  /Wait until this pack.s model finishes loading in Ollama/.test(html),
  "compact must not silently fake a summary when Ollama is down",
);

ok(
  "compact-uses-ollamaDirect",
  /isStandalone\(\)[\s\S]{0,400}ollamaDirect\(/.test(html),
  "standalone summarize must use this pack’s Ollama model",
);

ok(
  "wipe-double-confirm",
  /Click again to delete everything/.test(html) && /wipeArmed/.test(html),
  "delete must require a second click",
);

ok(
  "action-busy-guard",
  /function setActionBusy/.test(html) && /if \(actionBusy\) return;/.test(html),
  "summarize/delete must block double-clicks",
);

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nverified ${checks.length} local-agent guards`);
