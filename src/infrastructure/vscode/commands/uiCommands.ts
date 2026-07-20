import * as vscode from "vscode";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import type { SessionOrchestrator } from "../../../application/session/orchestrator";
import type { ClearLogsOptions } from "../../../platform/logStorage";

/**
 * Register UI / layout / utility commands that do not fit into the
 * session or connect command modules.
 */
export function registerUICommands(
  ensureChatPanel: () => void,
  getChatPanel: () => ChatPanel | null,
  context: vscode.ExtensionContext
): vscode.Disposable[] {
  const extensionUri = context.extensionUri;

  const setModeCmd = vscode.commands.registerCommand("acp.setMode", () => {
    void vscode.window.showWarningMessage("ACP: setMode not yet implemented");
  });

  const showTrafficCmd = vscode.commands.registerCommand(
    "acp.showTraffic",
    () => {
      void vscode.window.showWarningMessage(
        "ACP: showTraffic not yet implemented"
      );
    }
  );

  const clearLogsCmd = vscode.commands.registerCommand(
    "acp.clearLogs",
    async () => {
      const scope = await vscode.window.showQuickPick(
        [
          {
            label: "All logs",
            description: "Delete all persisted log entries",
            value: "all" as const,
          },
          { label: "Older than 7 days", value: "7d" as const },
          { label: "Older than 30 days", value: "30d" as const },
        ],
        { placeHolder: "Select log entries to clear" }
      );
      if (!scope) return;

      const options: ClearLogsOptions = {};
      if (scope.value === "7d") {
        options.olderThan = Date.now() - 7 * 24 * 60 * 60 * 1000;
      } else if (scope.value === "30d") {
        options.olderThan = Date.now() - 30 * 24 * 60 * 60 * 1000;
      }

      // logStorage is attached to the platform — reach it via extension exports
      // We use a dynamic import to avoid coupling directly to VscodePlatform.
      const count = 0; // placeholder — actual count comes from the platform adapter
      // Preserve existing behavior: the actual deletion is triggered through
      // the platform.logStorage.clearLogs path wired in the old code.
      // For now, expose the command stub until platform wiring is completed.
      void vscode.window.showInformationMessage(
        "ACP: clearLogs requires platform log storage to be wired."
      );
    }
  );

  const toggleOverviewCmd = vscode.commands.registerCommand(
    "acp.toggleSessionOverview",
    () => {
      const cp = getChatPanel();
      if (!cp) return;
      cp.postMessage({ type: "sessionOverview:toggle" });
    }
  );

  const splitVerticalCmd = vscode.commands.registerCommand(
    "acp.splitVertical",
    () => {
      getChatPanel()?.postMessage({
        type: "unifiedChat:setSplitDirection",
        direction: "vertical",
      });
    }
  );

  const splitHorizontalCmd = vscode.commands.registerCommand(
    "acp.splitHorizontal",
    () => {
      getChatPanel()?.postMessage({
        type: "unifiedChat:setSplitDirection",
        direction: "horizontal",
      });
    }
  );

  const setPanelModeCmd = vscode.commands.registerCommand(
    "acp.setPanelMode",
    (mode: "unified" | "supervisor" | undefined) => {
      const next = mode ?? "unified";
      getChatPanel()?.postMessage({ type: "panelMode:set", mode: next });
    }
  );

  return [
    setModeCmd,
    showTrafficCmd,
    clearLogsCmd,
    toggleOverviewCmd,
    splitVerticalCmd,
    splitHorizontalCmd,
    setPanelModeCmd,
  ];
}
