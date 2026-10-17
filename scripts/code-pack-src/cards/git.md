---
language: git
library: git
version: original
source_url: https://synap.surf/code-pack/cards/git
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## not a repository

fatal: not a git repository means this folder has no .git and no parent folder does either. You are not inside a clone or an init. cd to the project, or run git init if you meant to start a repository here. A deleted .git directory causes the same message.

## detached HEAD

A detached HEAD means HEAD points at a commit, not a branch. New commits are not on a branch name until you make one. git switch -c name starts a branch at the current commit and keeps those commits. git switch main returns to the branch and leaves the detached commits unless a branch points at them.

## non-fast-forward

A non-fast-forward rejection means the remote has commits you do not have. git pull fetches and merges or rebases those commits, then git push can fast-forward. Do not force-push unless you mean to overwrite the remote history. git push --force-with-lease refuses if the remote moved again.

## conflict markers

A merge conflict leaves conflict markers in the file. <<<<<<< marks your side, ======= splits the two sides, and >>>>>>> marks the other side. Edit the file down to the text you want, delete the markers, then git add the file. git status lists the paths that are still unmerged.
