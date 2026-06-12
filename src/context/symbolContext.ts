import * as path from "path";
import type { EditorAPI } from "../platform/editor";
import type { FileSystemAPI } from "../platform/filesystem";
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

interface RawSymbol {
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  containerName?: string;
}

export async function searchSymbols(
  editor: EditorAPI,
  query: string
): Promise<SuggestionItem[]> {
  const symbols = await editor.searchSymbols(query || "");
  if (!symbols) return [];

  const seen = new Set<string>();
  const results: SuggestionItem[] = [];

  for (const sym of symbols) {
    const key = `${sym.filePath}:${sym.startLine}:${sym.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const detail = sym.containerName
      ? `${sym.containerName} · ${sym.filePath}:${sym.startLine}`
      : `${sym.filePath}:${sym.startLine}`;

    results.push({
      id: `symbol:${sym.filePath}:${sym.startLine}:${sym.name}`,
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

async function fetchRawSymbols(
  editor: EditorAPI,
  query: string
): Promise<RawSymbol[]> {
  const symbols = await editor.searchSymbols(query);
  if (!symbols) return [];

  const seen = new Set<string>();
  const results: RawSymbol[] = [];

  for (const sym of symbols) {
    const key = `${sym.filePath}:${sym.startLine}:${sym.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      name: sym.name,
      kind: sym.kind,
      filePath: sym.filePath,
      startLine: sym.startLine,
      endLine: sym.endLine,
      containerName: sym.containerName || undefined,
    });
    if (results.length >= MAX_CANDIDATES) break;
  }
  return results;
}

export async function resolveSymbolByName(
  editor: EditorAPI,
  fs: FileSystemAPI,
  name: string
): Promise<ContextAttachmentDTO> {
  const candidates = await fetchRawSymbols(editor, name);
  if (candidates.length === 0) throw new Error(`Symbol not found: ${name}`);

  const exact = candidates.find((c) => c.name === name);
  const prefix = candidates.find((c) => c.name.startsWith(name));
  const best = exact ?? prefix ?? candidates[0];

  const content = await fs.readFile(best.filePath);
  const lines = content.split("\n");
  const symbolContent = lines.slice(best.startLine - 1, best.endLine).join("\n");

  const label = best.containerName
    ? `${best.containerName}.${best.name} (${best.kind})`
    : `${best.name} (${best.kind})`;

  return {
    id: crypto.randomUUID(),
    type: "symbol",
    path: best.filePath,
    label,
    lineRange: [best.startLine, best.endLine],
    tokenCount: estimateTokens(symbolContent),
    content: symbolContent,
  };
}

function kindIcon(kind: string): string {
  switch (kind) {
    case "class":
    case "struct":
      return "🔷";
    case "function":
    case "method":
      return "⚡";
    case "variable":
    case "field":
    case "constant":
      return "📦";
    case "interface":
      return "🔗";
    case "enum":
      return "📋";
    case "module":
    case "namespace":
      return "📁";
    default:
      return "🔹";
  }
}
