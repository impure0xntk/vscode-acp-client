// src/platform/diagnostics.ts

import type { DiagnosticProblem } from "./editor";

/**
 * Backend interface for retrieving file diagnostic information.
 * Replaceable per platform (VS Code / test / other).
 */
export interface DiagnosticBackend {
  /**
   * Returns diagnostics (errors, warnings, etc.) associated with the given file.
   * Returns an empty array when the file is not open, etc.
   */
  getProblemsForFile(filePath: string): DiagnosticProblem[];

  /**
   * Triggers the Language Server to re-run diagnostics after a file change.
   * Results arrive asynchronously; this call is only a trigger.
   * Actual diagnostics are retrieved via getProblemsForFile.
   *
   * In the VS Code implementation this waits for onDidChangeTextDocument to fire.
   */
  refreshDiagnostics(filePath: string): Promise<void>;
}
