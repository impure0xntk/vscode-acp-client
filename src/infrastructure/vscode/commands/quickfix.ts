import * as vscode from "vscode";
import type { SessionOrchestrator } from "../../../application/orchestrator";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import type { ContextAttachmentDTO } from "../../../domain/models/chat";

/**
 * Default prompt used when pre-filling the Composer to ask an agent to fix
 * the selected code. Overridable via the `acp.fix.prompt` setting.
 */
export const DEFAULT_FIX_PROMPT =
  "Please review and fix the selected code below. Explain the root cause of any issue, then provide a corrected version that follows the project's conventions and best practices. Apply the fix directly if you have the appropriate tools.";

/**
 * Read the fix prompt from settings, falling back to the default.
 */
export function getFixPrompt(): string {
  return vscode.workspace
    .getConfiguration("acp")
    .get<string>("fix.prompt", DEFAULT_FIX_PROMPT);
}

/**
 * Register the "Fix selection with agent" Quick Fix and its backing command.
 *
 * The Quick Fix (`vscode.CodeActionKind.QuickFix`) appears in the lightbulb
 * whenever a non-empty selection exists. Invoking it resolves the current editor
 * selection as a Composer attachment, opens the chat panel, and pre-fills the
 * Composer with a fix instruction so the user can forward it to an agent.
 */
export function registerQuickFixCommands(
  _orchestrator: SessionOrchestrator,
  getChatPanel: () => ChatPanel | null,
  ensureChatPanel: () => void,
  resolveSelection: () => Promise<ContextAttachmentDTO | null>
): vscode.Disposable[] {
  // acp.fixSelection — resolve the selection, attach it to the Composer,
  // and pre-fill a fix instruction for the user to send to an agent.
  const fixSelectionCmd = vscode.commands.registerCommand(
    "acp.fixSelection",
    async () => {
      const attachment = await resolveSelection();
      if (!attachment) {
        void vscode.window.showWarningMessage("ACP: No text selected");
        return;
      }
      ensureChatPanel();
      const prompt = getFixPrompt();
      // Reuse the same webview path as `acp.reviewChanges` — the Composer
      // listens for `acp:prepareReview` and merges the attachment + prompt.
      getChatPanel()?.postMessage({ type: "fix:prepare", attachment, prompt });
      // Focus the Composer so the user can refine or send immediately.
      setTimeout(() => getChatPanel()?.focusComposer(), 300);
    }
  );

  // Quick Fix code action — shows in the lightbulb for any non-empty selection.
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    [{ scheme: "file" }, { scheme: "untitled" }],
    {
      provideCodeActions(_document, range) {
        if (range.isEmpty) return [];
        const action = new vscode.CodeAction(
          "ACP: Fix selection with agent",
          vscode.CodeActionKind.QuickFix
        );
        action.command = {
          command: "acp.fixSelection",
          title: "Fix selection with agent",
        };
        return [action];
      },
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );

  return [fixSelectionCmd, codeActionProvider];
}
