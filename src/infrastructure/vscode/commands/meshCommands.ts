import * as vscode from "vscode";
import type { ChatPanel } from "../vscode-ui/chatPanel";

/**
 * Register mesh / start-team commands.
 */
export function registerMeshCommands(
  getChatPanel: () => ChatPanel | null,
  ensureChatPanel: () => void,
  context: vscode.ExtensionContext
): vscode.Disposable[] {
  const startTeamCmd = vscode.commands.registerCommand(
    "acp.startTeam",
    async () => {
      ensureChatPanel();
    }
  );

  return [startTeamCmd];
}
