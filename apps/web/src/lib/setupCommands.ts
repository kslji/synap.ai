/** One-line setup — works from any directory (script cds into its own folder). */

/** Finds the unzipped pack under Downloads and runs setup. Paste from anywhere. */
export const RUN_SETUP_UNIX =
  `bash "$(ls "$HOME"/Downloads/local-ai/LOCAL-SETUP.sh "$HOME"/Downloads/*/LOCAL-SETUP.sh 2>/dev/null | head -n 1)"`;

export const RUN_SETUP_WIN = `%USERPROFILE%\\Downloads\\local-ai\\LOCAL-SETUP.bat`;

/** Shown on /download and Setup dialog. */
export function runSetupCommand(os: "mac" | "win" | "linux"): string {
  return os === "win" ? RUN_SETUP_WIN : RUN_SETUP_UNIX;
}

export const VSCODE_URL = "https://code.visualstudio.com/download";
