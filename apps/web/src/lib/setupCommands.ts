/** One-line setup — works from any directory; picks among multiple packs. */

/** Short pasteable command — SURF-OPEN lists every unzipped pack. */
export const RUN_SETUP_UNIX =
  `bash "$(ls -t ~/Downloads/surf-ai-*/SURF-OPEN.sh 2>/dev/null | head -n 1)"`;

export const RUN_SETUP_WIN =
  `powershell -NoProfile -Command "& ((Get-ChildItem $env:USERPROFILE\\Downloads\\surf-ai-*\\SURF-OPEN.bat | Sort LastWriteTime -Desc | Select -First 1).FullName)"`;

/** Shown on /download and Setup dialog. */
export function runSetupCommand(os: "mac" | "win" | "linux"): string {
  return os === "win" ? RUN_SETUP_WIN : RUN_SETUP_UNIX;
}

export const VSCODE_URL = "https://code.visualstudio.com/download";
