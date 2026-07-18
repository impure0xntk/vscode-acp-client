import * as vscode from "vscode";
import type { PlatformAPI } from "../../platform/platform";
import type { ContextAttachmentDTO } from "../../domain/models/chat";
import {
  resolveFile as resolveFilePlatform,
  resolveSelection as resolveSelectionPlatform,
  resolveDiff as resolveDiffPlatform,
  resolveRange as resolveRangePlatform,
  resolveProblem as resolveProblemPlatform,
  type SerializedRange,
} from "../../adapter/context/assembler";
import { searchFiles as searchFilesPlatform } from "../../adapter/context/file";
import {
  searchSymbols as searchSymbolsPlatform,
  resolveSymbolByName as resolveSymbolByNamePlatform,
} from "../../adapter/context/symbol";
import { toPlatformUri } from "../../platform/adapters/vscode";
import type { DiagnosticProblem } from "../../platform/editor";
import { ChatPanel } from "./vscode-ui/chatPanel";
import { getLogger } from "../../platform/backends";

const log = getLogger("contextHelpers");

/** Shared module-level chat panel reference (set by extension.ts). */
let chatPanel: ChatPanel | null = null;

export function getChatPanel(): ChatPanel | null {
  return chatPanel;
}

export function setChatPanel(panel: ChatPanel): void {
  chatPanel = panel;
  chatPanel.logger = {
    debug: (msg) => log.debug(msg),
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
    error: (msg) => log.error(msg),
  };
}

/** Thin wrappers that delegate to the adapter layer, keeping activate() DRY. */

export function resolveFile(
  platform: PlatformAPI,
  filePath: string,
  cwd?: string
): Promise<ContextAttachmentDTO> {
  return resolveFilePlatform(
    platform.fs,
    filePath,
    cwd
  ) as Promise<ContextAttachmentDTO>;
}

export function resolveSelection(
  platform: PlatformAPI
): Promise<ContextAttachmentDTO | null> {
  return resolveSelectionPlatform(
    platform.editor
  ) as Promise<ContextAttachmentDTO | null>;
}

export function resolveDiff(
  platform: PlatformAPI
): Promise<ContextAttachmentDTO | null> {
  return resolveDiffPlatform(
    platform.editor
  ) as Promise<ContextAttachmentDTO | null>;
}

export function resolveRangeAt(
  platform: PlatformAPI,
  uri: string,
  range: SerializedRange
): Promise<ContextAttachmentDTO | null> {
  const vUri = vscode.Uri.parse(uri);
  return resolveRangePlatform(
    platform.editor,
    toPlatformUri(vUri),
    range
  ) as Promise<ContextAttachmentDTO | null>;
}

export function resolveProblem(
  platform: PlatformAPI,
  problem: DiagnosticProblem
): Promise<ContextAttachmentDTO | null> {
  return resolveProblemPlatform(
    platform.fs,
    problem
  ) as Promise<ContextAttachmentDTO | null>;
}

export function searchFiles(
  platform: PlatformAPI,
  query: string,
  cwd?: string
) {
  return searchFilesPlatform(platform.fs, query, cwd);
}

export function searchSymbols(platform: PlatformAPI, query: string) {
  return searchSymbolsPlatform(platform.editor, query);
}

export function resolveSymbolByName(
  platform: PlatformAPI,
  name: string
): Promise<ContextAttachmentDTO> {
  return resolveSymbolByNamePlatform(
    platform.editor,
    platform.fs,
    name
  ) as Promise<ContextAttachmentDTO>;
}
