import * as assert from "assert";
import { describe, it } from "mocha";
import {
  unwrapProblemArg,
  toDiagnosticProblem,
} from "../../infrastructure/vscode/commands/problemArg";

// Build a Markers-tree argument shape the way VS Code's Problems panel
// (`workbench.panel.markers`) passes it to `view/item/context` commands:
// a `MarkerElement` whose `.marker` is the model `Marker`, whose `.marker`
// is the `IMarkerData` (1-based line/col) and whose `.resource` is the file Uri.
function makeMarkerElement(opts: {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number;
  source?: string;
  code?: string | number;
  fsPath: string;
}) {
  const { fsPath, ...marker } = opts;
  return {
    marker: {
      resource: { fsPath, scheme: "file" },
      marker,
    },
  };
}

describe("problemArg.unwrapProblemArg", () => {
  it("resolves a single Markers tree element (element.marker.marker)", () => {
    const el = makeMarkerElement({
      startLineNumber: 12,
      startColumn: 3,
      endLineNumber: 12,
      endColumn: 20,
      message: "unused variable 'x'",
      severity: 4, // internal MarkerSeverity.Warning
      source: "eslint",
      code: "no-unused-vars",
      fsPath: "/ws/src/app.ts",
    });

    const { uri, data, kind } = unwrapProblemArg([el]);
    assert.ok(uri, "uri should be extracted from marker.resource");
    assert.strictEqual(uri?.fsPath, "/ws/src/app.ts");
    assert.strictEqual(kind, "marker");
    assert.ok(data && "startLineNumber" in data);
    assert.strictEqual(
      (data as { startLineNumber: number }).startLineNumber,
      12
    );
  });

  it("resolves the Uri nested at element.marker.resource", () => {
    // Real Markers tree element: the file Uri lives on the workbench `Marker`
    // one level below the tree node, not on the node itself.
    const el = makeMarkerElement({
      startLineNumber: 3,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 9,
      message: "something",
      severity: 8,
      source: "tsc",
      fsPath: "/ws/src/nested.ts",
    });

    const { uri } = unwrapProblemArg([el]);
    assert.strictEqual(uri?.fsPath, "/ws/src/nested.ts");
  });

  it("accepts a raw vscode.Diagnostic (range is 0-based)", () => {
    const diagnostic = {
      range: {
        start: { line: 4, character: 2 }, // 0-based -> 1-based 5:3
        end: { line: 4, character: 10 },
      },
      message: "type error",
      severity: 0, // DiagnosticSeverity.Error
      source: "tsc",
      code: 2322,
    };

    const { uri, data, kind } = unwrapProblemArg([
      diagnostic,
      { fsPath: "/ws/src/c.ts", scheme: "file" },
    ]);
    assert.strictEqual(kind, "diagnostic");
    assert.strictEqual(uri?.fsPath, "/ws/src/c.ts");
    assert.ok(data && "range" in data);
  });

  it("returns no data when nothing diagnostic-like is passed", () => {
    const { uri, data, kind } = unwrapProblemArg([{ foo: "bar" }, 42]);
    assert.strictEqual(data, undefined);
    assert.strictEqual(kind, undefined);
    assert.strictEqual(uri, undefined);
  });
});

describe("problemArg.toDiagnosticProblem", () => {
  it("maps internal MarkerSeverity (1/2/4/8) to domain severity", () => {
    const base = {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
      message: "m",
      severity: 8,
    } as const;
    assert.strictEqual(
      toDiagnosticProblem(base, "marker", "/f.ts")?.severity,
      "error"
    );
    assert.strictEqual(
      toDiagnosticProblem({ ...base, severity: 4 }, "marker", "/f.ts")
        ?.severity,
      "warning"
    );
    assert.strictEqual(
      toDiagnosticProblem({ ...base, severity: 2 }, "marker", "/f.ts")
        ?.severity,
      "info"
    );
    assert.strictEqual(
      toDiagnosticProblem({ ...base, severity: 1 }, "marker", "/f.ts")
        ?.severity,
      "hint"
    );
    assert.strictEqual(
      toDiagnosticProblem({ ...base, severity: 99 }, "marker", "/f.ts")
        ?.severity,
      "info"
    );
  });

  it("keeps 1-based line/col from marker data", () => {
    const problem = toDiagnosticProblem(
      {
        startLineNumber: 12,
        startColumn: 3,
        endLineNumber: 14,
        endColumn: 7,
        message: "unused",
        severity: 4,
        source: "eslint",
        code: "no-unused-vars",
      },
      "marker",
      "/ws/src/app.ts"
    );
    assert.deepStrictEqual(problem, {
      filePath: "/ws/src/app.ts",
      startLine: 12,
      startColumn: 3,
      endLine: 14,
      endColumn: 7,
      severity: "warning",
      message: "unused",
      source: "eslint",
      code: "no-unused-vars",
    });
  });

  it("converts a 0-based diagnostic range to 1-based", () => {
    const problem = toDiagnosticProblem(
      {
        range: {
          start: { line: 4, character: 2 },
          end: { line: 6, character: 9 },
        },
        message: "type error",
        severity: 0,
        source: "tsc",
        code: 2322,
      },
      "diagnostic",
      "/ws/src/c.ts"
    );
    assert.strictEqual(problem?.startLine, 5);
    assert.strictEqual(problem?.startColumn, 3);
    assert.strictEqual(problem?.endLine, 7);
    assert.strictEqual(problem?.endColumn, 10);
    assert.strictEqual(problem?.severity, "error");
    assert.strictEqual(problem?.code, "2322");
  });

  it("normalizes object-shaped code ({ value })", () => {
    const problem = toDiagnosticProblem(
      {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
        message: "m",
        severity: 2,
        code: { value: "ABC123" },
      },
      "marker",
      "/f.ts"
    );
    assert.strictEqual(problem?.code, "ABC123");
  });
});
