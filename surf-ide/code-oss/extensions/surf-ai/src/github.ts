/**
 * Surf GitHub integration.
 *
 * Three commands that make the IDE usable for a real production repo:
 *
 *   - **Sign in to GitHub** — the in-IDE account badge, backed by the fork's
 *     built-in `vscode.github-authentication`. That provider needs a GitHub
 *     OAuth App wired into `product.json` (see `surf-ide/fork-setup.mjs`); if it
 *     is not configured, the command says so and links the docs instead of
 *     failing silently.
 *   - **Push** — pushes the current branch to `origin` through the built-in `git`
 *     extension, so it uses whatever credentials the user already has (SSH key,
 *     Personal Access Token, or the OS credential helper). This works with no
 *     OAuth App at all — signing in is for the account UI, not for pushing.
 *   - **Create Pull Request** — pushes, then opens the repo's GitHub compare
 *     page (or `gh pr create` when the GitHub CLI is installed and authed).
 *
 * Nothing here talks to a Surf server; git operations run locally against the
 * repo's own remote.
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseRepoSlug, compareUrl } from './git-url';

const execFileAsync = promisify(execFile);

// Re-exported so the pure helpers stay testable without loading this vscode-bound
// module, while anything that already imports them from here keeps working.
export { parseRepoSlug, compareUrl } from './git-url';

/** The narrow slice of the `vscode.git` API v1 that these commands rely on. */
interface GitRepository {
  push(remote: string, branch: string): Promise<void>;
  state: {
    HEAD?: { name?: string; upstream?: { remote?: string }; ahead?: number };
    remotes: Array<{ name: string; fetchUrl?: string; pushUrl?: string }>;
    branches: Array<{ name: string; remote?: string }>;
  };
}
interface GitAPI {
  repositories: GitRepository[];
}
interface GitExtensionAPI {
  getAPI(version: number): GitAPI;
}

function repository(): GitRepository | null {
  const gitExt = vscode.extensions.getExtension<GitExtensionAPI>('vscode.git');
  const api = gitExt?.exports?.getAPI(1);
  return api?.repositories?.[0] ?? null;
}

export function registerGitHubCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.githubSignIn', async () => {
      try {
        const session = await vscode.authentication.getSession('github', ['read:user', 'repo'], {
          createIfNone: true
        });
        void vscode.window.showInformationMessage(`Surf: signed in to GitHub as ${session.account.label}.`);
      } catch {
        // The provider is absent (the fork's OAuth App is not configured) or the
        // user cancelled. Point at the one setup step rather than a bare failure.
        const open = 'Open setup docs';
        void vscode.window.showWarningMessage(
          'GitHub sign-in needs a GitHub OAuth App wired into this build (fork-setup.mjs). '
            + 'Push and Pull Requests still work with your local git credentials.',
          open
        ).then((choice) => {
          if (choice === open) {
            void vscode.env.openExternal(vscode.Uri.parse('https://synap.surf/docs/ide/github'));
          }
        });
      }
    }),

    vscode.commands.registerCommand('surf-ai.githubPush', async () => {
      const repo = repository();
      const branch = repo?.state.HEAD?.name;
      if (!repo || !branch) {
        void vscode.window.showErrorMessage('Surf: no git repository or branch is open.');
        return;
      }
      const remote = repo.state.HEAD?.upstream?.remote || repo.state.remotes.find((r) => r.name === 'origin')?.name || 'origin';
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Surf: pushing ${branch} to ${remote}…` },
          () => repo.push(remote, branch)
        );
        void vscode.window.showInformationMessage(`Surf: pushed ${branch} to ${remote}.`);
      } catch (error) {
        void vscode.window.showErrorMessage(`Surf: push failed — ${(error as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('surf-ai.githubCreatePR', async () => {
      const repo = repository();
      const branch = repo?.state.HEAD?.name;
      if (!repo || !branch) {
        void vscode.window.showErrorMessage('Surf: open a git repository on a branch first.');
        return;
      }
      const remote = repo.state.remotes.find((r) => r.name === 'origin') || repo.state.remotes[0];
      const slug = parseRepoSlug(remote?.pushUrl || remote?.fetchUrl || '');
      if (!slug) {
        void vscode.window.showErrorMessage('Surf: this repository has no GitHub remote to open a PR against.');
        return;
      }
      // Push so the branch exists on the remote, then hand off to GitHub.
      try {
        await repo.push('origin', branch);
      } catch (error) {
        void vscode.window.showErrorMessage(`Surf: could not push before PR — ${(error as Error).message}`);
        return;
      }
      const base = defaultBase(repo);
      if (await tryGhCli(branch, base)) {
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(compareUrl(slug, branch, base)));
    })
  );
}

/** The branch a PR targets: HEAD's parent branch name if it looks like main/master, else `main`. */
function defaultBase(repo: GitRepository): string {
  const names = repo.state.branches.map((b) => b.name);
  return ['main', 'master'].find((n) => names.includes(n)) || 'main';
}

/** If the GitHub CLI is installed and authed, create the PR through it. Returns whether it ran. */
async function tryGhCli(head: string, base: string): Promise<boolean> {
  try {
    const which = await execFileAsync('gh', ['--version']).then(() => true).catch(() => false);
    if (!which) {
      return false;
    }
    const authed = await execFileAsync('gh', ['auth', 'status']).then(() => true).catch(() => false);
    if (!authed) {
      return false;
    }
    const term = vscode.window.createTerminal({ name: 'Surf: Create PR' });
    term.sendText(`gh pr create --base ${base} --head ${head} --fill`, true);
    term.show();
    return true;
  } catch {
    return false;
  }
}
