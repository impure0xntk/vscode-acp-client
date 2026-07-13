import * as vscode from "vscode";

/**
 * Command id of the existing "Attach Problem to Chat" handler. The Quick Fix
 * provider reuses it (passing the diagnostic + file Uri as arguments) so a
 * problem right-clicked in the Problems panel — or flagged under the editor
 * lightbulb — reaches the Composer through the standard "Quick Fix…" menu
 * instead of the command palette.
 */
const ATTACH_PROBLEM_COMMAND = "acp.attachProblem";

const PROBLEM_QUICK_FIX_TITLE = "ACP: Attach Problem to Chat";

/**
 * Register a Quick Fix code-action provider for diagnostics so the existing
 * "Attach Problem to Chat" flow is reachable as a problem's Quick Fix. Right
 * clicking a problem in VS Code's Problems panel (or invoking the editor
 * lightbulb) and choosing "Quick Fix…" surfaces this action, which forwards
 * the specific diagnostic — its file, line, and message — to the Composer as
 * a `problem`-type attachment.
 *
 * Each diagnostic yields one action whose backing command is
 * `acp.attachProblem`; that command's argument parser already understands a
 * raw `vscode.Diagnostic` + `vscode.Uri` pair, so no new command is needed.
 */
export function registerProblemQuickFixProvider(): vscode.Disposable {
  const selector: vscode.DocumentSelector = { scheme: "file" };
  return vscode.languages.registerCodeActionsProvider(
    selector,
    {
      provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext
      ): vscode.CodeAction[] {
        if (!context.diagnostics || context.diagnostics.length === 0) {
          return [];
        }
        return context.diagnostics.map((diagnostic) => {
          const action = new vscode.CodeAction(
            PROBLEM_QUICK_FIX_TITLE,
            vscode.CodeActionKind.QuickFix
          );
          // Anchor the action on the exact diagnostic so it shows under the
          // correct problem and the Composer opens the right file:line.
          action.diagnostics = [diagnostic];
          action.command = {
            command: ATTACH_PROBLEM_COMMAND,
            title: PROBLEM_QUICK_FIX_TITLE,
            arguments: [diagnostic, document.uri],
          };
          return action;
        });
      },
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );
}
