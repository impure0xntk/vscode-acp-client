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
 * Register the "Fix selection with agent" and "Attach selection to chat"
 * commands, both wired to the editor context menu (when text is selected).
 *
 * These commands resolve the active selection (or the range passed via command
 * arguments) as a Composer attachment. The backing commands are intentionally
 * exposed only through the editor context menu and the command palette — not as
 * Quick Fix code actions on diagnostics — so a problem's right-click shows only
 * the dedicated "ACP: Attach Problem to Chat" entry.
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

  return [fixSelectionCmd, attachQuickFixCmd];
}
