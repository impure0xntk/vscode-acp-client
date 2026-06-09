import * as vscode from "vscode";
import * as path from "path";
import { estimateTokens } from "./assembler";

export type ContextAttachmentDTO = {
  id: string;
  type: "file" | "selection" | "symbol" | "diff";
  path: string;
  label: string;
  lineRange?: [number, number];
  tokenCount: number;
  content: string;
};

export interface SuggestionItem {
  id: string;
  kind: "file" | "selection" | "diff" | "command" | "symbol";
  label: string;
  value: string;
  detail?: string;
  icon?: string;
}

const MAX_CANDIDATES = 50;

const KIND_LABELS: Record<vscode.SymbolKind, string> = {
  [vscode.SymbolKind.File]: "file",
  [vscode.SymbolKind.Module]: "module",
  [vscode.SymbolKind.Namespace]: "namespace",
  [vscode.SymbolKind.Package]: "package",
  [vscode.SymbolKind.Class]: "class",
  [vscode.SymbolKind.Method]: "method",
  [vscode.SymbolKind.Property]: "property",
  [vscode.SymbolKind.Field]: "field",
  [vscode.SymbolKind.Constructor]: "constructor",
  [vscode.SymbolKind.Enum]: "enum",
  [vscode.SymbolKind.Interface]: "interface",
  [vscode.SymbolKind.Function]: "function",
  [vscode.SymbolKind.Variable]: "var",
  [vscode.SymbolKind.Constant]: "const",
  [vscode.SymbolKind.String]: "string",
  [vscode.SymbolKind.Number]: "number",
  [vscode.SymbolKind.Boolean]: "bool",
  [vscode.SymbolKind.Array]: "array",
  [vscode.SymbolKind.Object]: "object",
  [vscode.SymbolKind.Key]: "key",
  [vscode.SymbolKind.Null]: "null",
  [vscode.SymbolKind.EnumMember]: "enum member",
  [vscode.SymbolKind.Struct]: "struct",
  [vscode.SymbolKind.Event]: "event",
  [vscode.SymbolKind.Operator]: "operator",
  [vscode.SymbolKind.TypeParameter]: "type param",
};

function kindLabel(kind: vscode.SymbolKind): string {
  return KIND_LABELS[kind] ?? "symbol";
}

function kindIcon(kind: vscode.SymbolKind): string {
  switch (kind) {
    case vscode.SymbolKind.Class:
    case vscode.SymbolKind.Struct:
      return "🔷";
    case vscode.SymbolKind.Function:
    case vscode.SymbolKind.Method:
      return "⚡";
    case vscode.SymbolKind.Variable:
    case vscode.SymbolKind.Field:
    case vscode.SymbolKind.Constant:
      return "📦";
    case vscode.SymbolKind.Interface:
      return "🔗";
    case vscode.SymbolKind.Enum:
      return "📋";
    case vscode.SymbolKind.Module:
    case vscode.SymbolKind.Namespace:
      return "📁";
    default:
      return "🔹";
  }
}

interface RawSymbol {
  name: string;
  kind: vscode.SymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
  containerName?: string;
}

/**
 * Search workspace symbols matching a query string.
 * Uses vscode.executeWorkspaceSymbolProvider for fuzzy search.
 * Returns SuggestionItem[] for the picker UI.
 */
export async function searchSymbols(query: string): Promise<SuggestionItem[]> {
  // Empty query returns top-level symbols (classes, functions, etc.)
  const raw = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    "vscode.executeWorkspaceSymbolProvider",
    query || ""  // empty string triggers "show all" behavior
  );

  if (!raw) return [];

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const seen = new Set<string>();
  const results: SuggestionItem[] = [];

  for (const sym of raw) {
    const key = `${sym.location.uri.fsPath}:${sym.location.range.start.line}:${sym.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const relPath = path.relative(ws, sym.location.uri.fsPath);
    const detail = sym.containerName
      ? `${sym.containerName} · ${relPath}:${sym.location.range.start.line + 1}`
      : `${relPath}:${sym.location.range.start.line + 1}`;

    results.push({
      id: `symbol:${relPath}:${sym.location.range.start.line}:${sym.name}`,
      kind: "symbol",
      label: sym.name,
      value: sym.name,
      detail,
      icon: kindIcon(sym.kind),
    });

    if (results.length >= MAX_CANDIDATES) break;
  }

  return results;
}

/**
 * Internal: fetch raw symbol data for resolution.
 */
async function fetchRawSymbols(query: string): Promise<RawSymbol[]> {
  const raw = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    "vscode.executeWorkspaceSymbolProvider",
    query
  );
  if (!raw) return [];

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const seen = new Set<string>();
  const results: RawSymbol[] = [];

  for (const sym of raw) {
    const key = `${sym.location.uri.fsPath}:${sym.location.range.start.line}:${sym.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      name: sym.name,
      kind: sym.kind,
      filePath: path.relative(ws, sym.location.uri.fsPath),
      startLine: sym.location.range.start.line + 1,
      endLine: sym.location.range.end.line + 1,
      containerName: sym.containerName || undefined,
    });
    if (results.length >= MAX_CANDIDATES) break;
  }
  return results;
}

/**
 * Resolve a symbol by name: search workspace symbols, pick the best match,
 * then read the source range and return a ContextAttachment.
 */
export async function resolveSymbolByName(name: string): Promise<ContextAttachmentDTO> {
  const candidates = await fetchRawSymbols(name);
  if (candidates.length === 0) throw new Error(`Symbol not found: ${name}`);

  const exact = candidates.find((c) => c.name === name);
  const prefix = candidates.find((c) => c.name.startsWith(name));
  const best = exact ?? prefix ?? candidates[0];

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const absPath = path.isAbsolute(best.filePath) ? best.filePath : path.join(ws, best.filePath);
  const uri = vscode.Uri.file(absPath);

  const doc = await vscode.workspace.openTextDocument(uri);
  const lines = doc.getText().split("\n");
  const content = lines.slice(best.startLine - 1, best.endLine).join("\n");

  const label = best.containerName
    ? `${best.containerName}.${best.name} (${kindLabel(best.kind)})`
    : `${best.name} (${kindLabel(best.kind)})`;

  return {
    id: crypto.randomUUID(),
    type: "symbol",
    path: best.filePath,
    label,
    lineRange: [best.startLine, best.endLine],
    tokenCount: estimateTokens(content),
    content,
  };
}
