import * as vscode from "vscode";
import type { DiagnosticBackend } from "../diagnostics";
import type { DiagnosticProblem } from "../editor";

/**
 * VS Code implementation of DiagnosticBackend.
 * Uses vscode.languages.getDiagnostics to retrieve diagnostic information.
 */
export class VscodeDiagnosticBackend implements DiagnosticBackend {
  getProblemsForFile(filePath: string): DiagnosticProblem[] {
    const uri = vscode.Uri.file(filePath);
    const diags = vscode.languages.getDiagnostics(uri);
    return diags.map((d) => ({
      filePath,
      startLine: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      severity: mapSeverity(d.severity),
      message: d.message,
      source: d.source,
      code:
        typeof d.code === "string"
          ? d.code
          : typeof d.code === "object" && d.code !== null && "value" in d.code
            ? d.code.value.toString()
            : undefined,
    }));
  }

  async refreshDiagnostics(_filePath: string): Promise<void> {
    // VS Code は外部のファイル変更を検知すると自動的に Language Server が起動する。
    // 多少の遅延を許容するため、ここでは軽いディレイのみ入れる。
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function mapSeverity(
  severity: vscode.DiagnosticSeverity
): DiagnosticProblem["severity"] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "info";
  }
}
