import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import type { ChatPanel } from "./vscode-ui/chatPanel";

const execAsync = promisify(exec);

async function getStatuslineInfo(workspaceRoot: string): Promise<{
  hostname: string;
  repoName: string;
  branch: string;
  tag?: string;
}> {
  const hostname = os.hostname();
  let repoName = path.basename(workspaceRoot);
  try {
    const { stdout } = await execAsync("git remote get-url origin", {
      cwd: workspaceRoot,
    });
    const remote = stdout.trim();
    const match = remote.match(/[:/]([^/]+?)(\.git)?$/);
    if (match) repoName = match[1];
  } catch {
    /* not a git repo — keep directory name */
  }

  let branch = "";
  try {
    const { stdout } = await execAsync("git branch --show-current", {
      cwd: workspaceRoot,
    });
    branch = stdout.trim();
  } catch {
    try {
      const { stdout } = await execAsync("git rev-parse --short HEAD", {
        cwd: workspaceRoot,
      });
      branch = stdout.trim();
    } catch {
      branch = "—";
    }
  }

  let tag: string | undefined;
  try {
    const { stdout } = await execAsync("git describe --tags --exact-match", {
      cwd: workspaceRoot,
    });
    tag = stdout.trim();
  } catch {
    /* no tag on HEAD */
  }

  return { hostname, repoName, branch, tag };
}

async function sendStatuslineInfo(
  getChatPanel: () => ChatPanel | null
): Promise<void> {
  const cp = getChatPanel();
  if (!cp) return;
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) return;
  const info = await getStatuslineInfo(ws);
  cp.postMessage({ type: "statusline", ...info });
}

let statuslineTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleStatuslineInfo(
  getChatPanel: () => ChatPanel | null,
  delayMs = 500
): void {
  if (statuslineTimer) clearTimeout(statuslineTimer);
  statuslineTimer = setTimeout(() => {
    statuslineTimer = null;
    void sendStatuslineInfo(getChatPanel);
  }, delayMs);
}

export { sendStatuslineInfo, scheduleStatuslineInfo };
