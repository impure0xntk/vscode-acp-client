import * as vscode from "vscode";
import type { SessionOrchestrator } from "../../../application/orchestrator";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import type { ContextAttachmentDTO } from "../../../domain/models/chat";
import type { SerializedRange } from "../../../adapter/context/assembler";
import {
  resolveFixAttachment,
  type FixSelectionArgs,
} from "./quickfixResolver";

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
 * for any non-empty range — including a diagnostic "problem" range, not just a
 * user selection. Invoking it resolves the *range it was invoked on* (passed
 * through as command arguments) as a Composer attachment, opens the chat panel,
 * and pre-fills the Composer with a fix instruction so the user can forward it to
 * an agent. Passing the range explicitly is required: when the Quick Fix is fired
 * from a problem's lightbulb, the active editor selection is empty, so reading
 * `editor.activeEditor` would resolve nothing.
 */
export function registerQuickFixCommands(
  _orchestrator: SessionOrchestrator,
  getChatPanel: () => ChatPanel | null,
  ensureChatPanel: () => void,
  resolveSelection: () => Promise<ContextAttachmentDTO | null>,
  resolveRangeAt: (
    uri: string,
    range: SerializedRange
  ) => Promise<ContextAttachmentDTO | null>
): vscode.Disposable[] {
  // acp.fixSelection — resolve the range (or active selection) as an
  // attachment, attach it to the Composer, and pre-fill a fix instruction
  // for the user to send to an agent.
  const fixSelectionCmd = vscode.commands.registerCommand(
    "acp.fixSelection",
    async (args?: FixSelectionArgs) => {
      const attachment = await resolveFixAttachment(
        args,
        resolveRangeAt,
        resolveSelection
      );
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

  // acp.attachQuickFix — resolve the range (or active selection) as a Composer
  // attachment and attach it WITHOUT pre-filling any instruction. The user
  // stages the selection as context and types their own prompt in the Composer.
  // Reuses the existing `attachContext` webview message, which appends the
  // attachment to the Composer and injects no prompt text.
  const attachQuickFixCmd = vscode.commands.registerCommand(
    "acp.attachQuickFix",
    async (args?: FixSelectionArgs) => {
      const attachment = await resolveFixAttachment(
        args,
        resolveRangeAt,
        resolveSelection
      );
      if (!attachment) {
        void vscode.window.showWarningMessage("ACP: No text selected");
        return;
      }
      ensureChatPanel();
      // Inject into the Composer as a context attachment only — no prompt.
      getChatPanel()?.postMessage({ type: "attachContext", attachment });
      // Focus the Composer so the user can type their prompt next to the chip.
      setTimeout(() => getChatPanel()?.focusComposer(), 300);
    }
  );

  // Quick Fix code action — shows in the lightbulb for any non-empty range,
  // including diagnostic "problem" ranges. The range is passed through to the
  // command so the attachment reflects exactly what the user clicked on.
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    [{ scheme: "file" }, { scheme: "untitled" }],
    {
      provideCodeActions(document, range) {
        if (range.isEmpty) return [];
        // Only `file:` documents are resolvable from disk via the platform
        // assembler; for `untitled:` the command falls back to the active
        // editor selection.
        const commandArgs =
          document.uri.scheme === "file"
            ? [
                {
                  uri: document.uri.toString(),
                  range: {
                    startLine: range.start.line,
                    startCharacter: range.start.character,
                    endLine: range.end.line,
                    endCharacter: range.end.character,
                  },
                },
              ]
            : [];
        const fixAction = new vscode.CodeAction(
          "ACP: Fix selection with agent",
          vscode.CodeActionKind.QuickFix
        );
        fixAction.command = {
          command: "acp.fixSelection",
          title: "Fix selection with agent",
          arguments: commandArgs,
        };
        const attachAction = new vscode.CodeAction(
          "ACP: Attach selection to chat",
          vscode.CodeActionKind.QuickFix
        );
        attachAction.command = {
          command: "acp.attachQuickFix",
          title: "Attach selection to chat",
          arguments: commandArgs,
        };
        return [fixAction, attachAction];
      },
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );

  return [fixSelectionCmd, attachQuickFixCmd, codeActionProvider];
}
