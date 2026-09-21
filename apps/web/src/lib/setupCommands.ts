/** One-line setup — works from any directory; picks among multiple packs. */

/** Finds SURF-OPEN in Downloads and lists every unzipped pack before launching. */
export const RUN_SETUP_UNIX =
  `bash "$(ls -t "$HOME"/Downloads/surf-ai-*/SURF-OPEN.sh "$HOME"/Downloads/*/SURF-OPEN.sh "$HOME"/Downloads/local-ai/SURF-OPEN.sh 2>/dev/null | head -n 1)"`;

export const RUN_SETUP_WIN =
  `powershell -NoProfile -Command "& ((Get-ChildItem -Path $env:USERPROFILE\\Downloads -Recurse -Filter SURF-OPEN.bat -Depth 3 | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName)"`;

/** Shown on /download and Setup dialog. */
export function runSetupCommand(os: "mac" | "win" | "linux"): string {
  return os === "win" ? RUN_SETUP_WIN : RUN_SETUP_UNIX;
}

export const VSCODE_URL = "https://code.visualstudio.com/download";
