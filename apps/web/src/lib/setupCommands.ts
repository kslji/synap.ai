/** One-line setup — works from any directory; picks among multiple packs. */

/** Short pasteable command — SURF-OPEN lists every unzipped pack. */
export const RUN_SETUP_UNIX =
  `bash "$(ls -t ~/Downloads/surf-ai-*/SURF-OPEN.sh 2>/dev/null | head -n 1)"`;

export const RUN_SETUP_WIN =
  `powershell -NoProfile -Command "& ((Get-ChildItem $env:USERPROFILE\\Downloads\\surf-ai-*\\SURF-OPEN.bat | Sort LastWriteTime -Desc | Select -First 1).FullName)"`;

/** Optional — fixed pack evals (guardrails + Moss + identity). */
export const RUN_EVALS_UNIX =
  `bash "$(ls -t ~/Downloads/surf-ai-*/harness/run-evals.sh 2>/dev/null | head -n 1)"`;

export const RUN_EVALS_WIN =
  `powershell -NoProfile -Command "& ((Get-ChildItem $env:USERPROFILE\\Downloads\\surf-ai-*\\harness\\run-evals.bat | Sort LastWriteTime -Desc | Select -First 1).FullName)"`;

/** Optional — your editable cases in harness/custom_cases.json. */
export const RUN_CUSTOM_UNIX =
  `bash "$(ls -t ~/Downloads/surf-ai-*/harness/run-custom.sh 2>/dev/null | head -n 1)"`;

export const RUN_CUSTOM_WIN =
  `powershell -NoProfile -Command "& ((Get-ChildItem $env:USERPROFILE\\Downloads\\surf-ai-*\\harness\\run-custom.bat | Sort LastWriteTime -Desc | Select -First 1).FullName)"`;

/** Shown on /download and Setup dialog. */
export function runSetupCommand(os: "mac" | "win" | "linux"): string {
  return os === "win" ? RUN_SETUP_WIN : RUN_SETUP_UNIX;
}

/** Optional verify — fixed Surf harness cases. */
export function runEvalsCommand(os: "mac" | "win" | "linux"): string {
  return os === "win" ? RUN_EVALS_WIN : RUN_EVALS_UNIX;
}

/** Optional verify — user-customizable cases. */
export function runCustomHarnessCommand(os: "mac" | "win" | "linux"): string {
  return os === "win" ? RUN_CUSTOM_WIN : RUN_CUSTOM_UNIX;
}

export const VSCODE_URL = "https://code.visualstudio.com/download";
