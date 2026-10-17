---
language: bash
library: bash
version: original
source_url: https://synap.surf/code-pack/cards/bash
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## set euo pipefail

set -euo pipefail is a strict header for a Bash script. -e exits when a command returns non-zero. -u errors on unset variables. pipefail makes a pipeline fail if any command fails, not only the last one. Put it under the shebang. A command that is allowed to fail needs an explicit if or || true.

## Quote variables

Quote "$var" so spaces do not split words and so an empty value stays one argument. $var without quotes undergoes word splitting and globbing. Quote paths. "$@" keeps each argument separate. $* joins them.

## command not found

A "command not found" message means the program is not on PATH. The shell searched each directory in PATH and did not find an executable with that name. Install the program, or call it by its path. A script bit that is not set also prevents execution, and the message then says permission denied rather than command not found.
