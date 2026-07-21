// Pure (vscode-free) parsing of the arguments VS Code hands the
// `acp.attachProblem` command when a problem is right-clicked in the Problems
// panel. Kept separate from session.ts so it can be unit-tested without the
// VS Code runtime.

import type { DiagnosticProblem } from "../../../platform/editor";

/**
 * VS Code's Problems panel is the Markers tree view (`workbench.panel.markers`).
 * Its context menu is contributed through `view/item/context`, and the selected
 * tree element(s) are passed to the command as arguments. A single
 * right-clicked problem yields one `MarkerElement` whose `.marker` is the model
 * `Marker`; that exposes `.resource` (the file Uri) and `.marker` (the
 * IMarkerData with 1-based line/col numbers, message, severity, source, code).
 *
 * The earlier implementation assumed a `problems/context` menu that hands a
 * raw `vscode.Diagnostic` + `vscode.Uri`; `problems/context` is not a real VS
 * Code menu id, so the item never appeared. These helpers normalize the actual
 * tree-element shape (and still accept a raw `vscode.Diagnostic` pair) into a
 * `DiagnosticProblem`.
 */

interface UriLike {
  fsPath: string;
  scheme?: string;
}

interface IMarkerDataLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number;
  source?: string;
  code?: string | number | { value: string | number; target?: unknown };
}

interface IDiagnosticLike {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  severity: number;
  source?: string;
  code?: string | number | { value: string | number; target?: unknown };
}

type ProblemArgKind = "marker" | "diagnostic";

function asUriValue(value: unknown): UriLike | undefined {
  if (
    value &&
    typeof value === "object" &&
    "fsPath" in value &&
    "scheme" in value
  ) {
    const candidate = value as { fsPath: unknown; scheme: unknown };
    if (
      typeof candidate.fsPath === "string" &&
      typeof candidate.scheme === "string"
    ) {
      return value as UriLike;
    }
  }
  return undefined;
}

function readField(value: unknown, key: string): unknown {
  if (value && typeof value === "object" && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

function asMarkerData(
  value: unknown
): { data: IMarkerDataLike; kind: ProblemArgKind } | undefined {
  if (value && typeof value === "object" && "startLineNumber" in value) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.startLineNumber === "number") {
      return { data: value as IMarkerDataLike, kind: "marker" };
    }
  }
  return undefined;
}

function asDiagnosticData(
  value: unknown
): { data: IDiagnosticLike; kind: ProblemArgKind } | undefined {
  if (
    value &&
    typeof value === "object" &&
    "range" in value &&
    "message" in value
  ) {
    const candidate = value as Record<string, unknown>;
    const range = candidate.range as Record<string, unknown> | undefined;
    const start = range?.start as Record<string, unknown> | undefined;
    if (
      start &&
      typeof start.line === "number" &&
      typeof start.character === "number"
    ) {
      return { data: value as IDiagnosticLike, kind: "diagnostic" };
    }
  }
  return undefined;
}

/**
 * Pull a file Uri and a marker-shaped diagnostic out of the arguments VS Code
 * hands the command. The Markers view nests the IMarkerData under
 * `element.marker.marker`, so we probe up to two `.marker` levels plus the raw
 * `vscode.Diagnostic` shapes. Any single argument may be a Uri, the tree
 * element, or the diagnostic itself.
 */
export function unwrapProblemArg(args: unknown[]): {
  uri?: UriLike;
  data?: IMarkerDataLike | IDiagnosticLike;
  kind?: ProblemArgKind;
} {
  let uri: UriLike | undefined;
  let data: (IMarkerDataLike | IDiagnosticLike) | undefined;
  let kind: ProblemArgKind | undefined;

  const probe = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const asRec = value as Record<string, unknown>;

    // The file Uri may sit either on the arg itself, on `.resource`, or —
    // for the Markers tree — nested at `element.marker.resource` (the
    // workbench `Marker` keeps the resource one level below the tree node).
    const foundUri =
      asUriValue(value) ??
      asUriValue(readField(value, "resource")) ??
      asUriValue(readField(readField(value, "marker"), "resource"));
    if (foundUri && !uri) uri = foundUri;

    const marker =
      asMarkerData(value) ??
      asDiagnosticData(value) ??
      asMarkerData(readField(value, "marker")) ??
      asDiagnosticData(readField(value, "marker")) ??
      asMarkerData(readField(readField(value, "marker"), "marker")) ??
      asDiagnosticData(readField(readField(value, "marker"), "marker"));
    if (marker && !data) {
      data = marker.data;
      kind = marker.kind;
    }
  };

  for (const a of args) probe(a);
  return { uri, data, kind };
}

function normalizeProblemCode(
  code:
    | string
    | number
    | { value: string | number; target?: unknown }
    | undefined
): string | undefined {
  if (code === undefined) return undefined;
  if (typeof code === "string" || typeof code === "number") return String(code);
  if (typeof code === "object" && "value" in code) return String(code.value);
  return undefined;
}

function mapMarkerSeverity(severity: number): DiagnosticProblem["severity"] {
  // Markers view IMarkerData.severity uses the *internal* MarkerSeverity
  // enum, which is NOT part of the public extension API (so we
  // hard-code the values): Hint=1, Info=2, Warning=4, Error=8.
  switch (severity) {
    case 1:
      return "hint";
    case 2:
      return "info";
    case 4:
      return "warning";
    case 8:
      return "error";
    default:
      return "info";
  }
}

function mapDiagnosticSeverity(
  severity: number
): DiagnosticProblem["severity"] {
  // vscode.DiagnosticSeverity: Error=0, Warning=1, Information=2, Hint=3
  switch (severity) {
    case 0:
      return "error";
    case 1:
      return "warning";
    case 2:
      return "info";
    case 3:
      return "hint";
    default:
      return "info";
  }
}

export function toDiagnosticProblem(
  data: IMarkerDataLike | IDiagnosticLike,
  kind: ProblemArgKind,
  filePath: string
): DiagnosticProblem | undefined {
  if (kind === "marker") {
    const m = data as IMarkerDataLike;
    return {
      filePath,
      startLine: m.startLineNumber,
      startColumn: m.startColumn,
      endLine: m.endLineNumber,
      endColumn: m.endColumn,
      severity: mapMarkerSeverity(m.severity),
      message: m.message,
      source: m.source,
      code: normalizeProblemCode(m.code),
    };
  }
  const d = data as IDiagnosticLike;
  return {
    filePath,
    startLine: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLine: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
    severity: mapDiagnosticSeverity(d.severity),
    message: d.message,
    source: d.source,
    code: normalizeProblemCode(d.code),
  };
}
