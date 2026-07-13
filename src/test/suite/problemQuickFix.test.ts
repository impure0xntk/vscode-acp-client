import * as assert from "assert";
import { describe, it } from "mocha";
import { unwrapProblemArg, toDiagnosticProblem } from "../../infrastructure/vscode/commands/problemArg";

// The Quick Fix provider (registerProblemQuickFixProvider) feeds the
// `acp.attachProblem` handler with `[diagnostic, document.uri]`. This test
// locks that contract: the argument shape the provider produces must resolve
// through the same parser the command uses, so a problem right-clicked in the
// Problems panel attaches with the correct file, 1-based line/col, and
// severity.
describe("problemQuickFix provider → acp.attachProblem contract", () => {
  function makeDiagnostic(opts: {
    startLine: number; // 0-based line
    startChar: number;
    endLine: number;
    endChar: number;
    message: string;
    severity: number;
    source?: string;
    code?: string | number;
  }) {
    return {
      range: {
        start: { line: opts.startLine, character: opts.startChar },
        end: { line: opts.endLine, character: opts.endChar },
      },
      message: opts.message,
      severity: opts.severity,
      source: opts.source,
      code: opts.code,
    };
  }

  it("resolves a raw diagnostic + Uri into the problem attachment", () => {
    const diagnostic = makeDiagnostic({
      startLine: 4,
      startChar: 2,
      endLine: 6,
      endChar: 9,
      message: "type error",
      severity: 0, // DiagnosticSeverity.Error
      source: "tsc",
      code: 2322,
    });
    const uri = { fsPath: "/ws/src/c.ts", scheme: "file" };

    const { uri: outUri, data, kind } = unwrapProblemArg([diagnostic, uri]);
    assert.strictEqual(kind, "diagnostic");
    assert.strictEqual(outUri?.fsPath, "/ws/src/c.ts");

    const problem = toDiagnosticProblem(data!, kind!, outUri!.fsPath);
    assert.strictEqual(problem?.filePath, "/ws/src/c.ts");
    assert.strictEqual(problem?.startLine, 5); // 0-based → 1-based
    assert.strictEqual(problem?.startColumn, 3);
    assert.strictEqual(problem?.endLine, 7);
    assert.strictEqual(problem?.endColumn, 10);
    assert.strictEqual(problem?.severity, "error");
    assert.strictEqual(problem?.code, "2322");
  });
});
