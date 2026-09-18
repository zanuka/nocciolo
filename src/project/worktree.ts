import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * A linked git worktree has a `.git` file (not directory) whose git-dir lives
 * under the main repo's `.git/worktrees/<name>`, so `--git-dir` and
 * `--git-common-dir` diverge. This is the git-native signal for "this is a
 * disposable worktree, not the durable clone" — no path-naming convention
 * (e.g. `.treehouse/`) is required to detect it.
 */
export async function isGitWorktree(root: string): Promise<boolean> {
  try {
    const [gitDir, commonDir] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: root }),
      execFileAsync("git", ["rev-parse", "--git-common-dir"], { cwd: root }),
    ]);
    return gitDir.stdout.trim() !== commonDir.stdout.trim();
  } catch {
    return false;
  }
}
