// src/infrastructure/vscode/commands/exportDebugLog.ts
//
// acp.exportDebugLog — export sessions + logs as a gzipped JSON file.
//
// Flow:
//   1. QuickPick: scope (session-specific / last N hours / all)
//   2. Session picker (if session-specific)
//   3. File save dialog
//   4. Write .json.gz

import * as vscode from "vscode";
import * as zlib from "zlib";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { PersistentHistoryStore } from "../../../application/session/persistentHistory";
import type { LogExportFilter, LogExportResult } from "../../../application/session/persistentHistory";

// ── Scope selection ────────────────────────────────────────────────────────

type ExportScope =
  | { kind: "session"; sessionId: string }
  | { kind: "hours"; hours: number }
  | { kind: "all" };

// ── Public command registration ────────────────────────────────────────────

export function registerExportDebugLogCommand(
  context: vscode.ExtensionContext,
  getStore: () => PersistentHistoryStore | null
): vscode.Disposable {
  return vscode.commands.registerCommand("acp.exportDebugLog", async () => {
    const store = getStore();
    if (!store) {
      await vscode.window.showWarningMessage("ACP: Log store not initialized.");
      return;
    }

    // Step 1: scope
    const scope = await pickScope(store);
    if (!scope) return;

    // Step 2: build filter
    const filter = buildFilter(scope, store);
    if (!filter) return;

    // Step 3: pick output file
    const defaultName = `acp-debug-${new Date().toISOString().slice(0, 10)}.json`;
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), "Desktop", defaultName)),
      filters: { "Gzipped JSON": ["json.gz"] },
    });
    if (!saveUri) return;

    // Step 4: export
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Exporting debug logs…",
          cancellable: false,
        },
        async () => {
          const result = buildExportData(store, filter);
          const json = JSON.stringify(result, null, 2);
          const compressed = zlib.gzipSync(Buffer.from(json, "utf-8"));
          await fs.promises.writeFile(saveUri.fsPath, compressed);
        }
      );
      await vscode.window.showInformationMessage(
        `ACP: Debug log exported to ${saveUri.fsPath}`
      );
    } catch (err) {
      await vscode.window.showErrorMessage(
        `ACP: Export failed — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}

// ── Scope picker ───────────────────────────────────────────────────────────

async function pickScope(store: PersistentHistoryStore): Promise<ExportScope | undefined> {
  const sessions = store.getAllSessions();

  const items: (vscode.QuickPickItem & { scope: ExportScope })[] = [
    {
      label: "$(output) All logs (all time)",
      description: "Export every persisted log entry",
      scope: { kind: "all" },
    },
    {
      label: "$(clock) Last N hours",
      description: "Export logs from the last 1, 6, 24, or 72 hours",
      scope: { kind: "hours", hours: 24 }, // default, will be refined
    },
    {
      label: "$(symbol-class) Specific session",
      description: `${sessions.length} session(s) available`,
      scope: { kind: "session", sessionId: "" }, // placeholder
    },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Select export scope",
  });
  if (!pick) return undefined;

  if (pick.scope.kind === "hours") {
    const hours = await vscode.window.showQuickPick(
      [
        { label: "1 hour", value: 1 },
        { label: "6 hours", value: 6 },
        { label: "24 hours", value: 24 },
        { label: "72 hours", value: 72 },
      ],
      { placeHolder: "Time range" }
    );
    if (!hours) return undefined;
    return { kind: "hours", hours: hours.value };
  }

  if (pick.scope.kind === "session") {
    if (sessions.length === 0) {
      await vscode.window.showWarningMessage("ACP: No sessions found.");
      return undefined;
    }
    const sessionPick = await vscode.window.showQuickPick(
      sessions.map((s) => ({
        label: `$(circle-outline) ${s.title}`,
        description: `${s.agentId} · ${s.sessionId.slice(0, 8)} · ${s.messageCount} msgs`,
        sessionId: s.sessionId,
      })),
      { placeHolder: "Select session" }
    );
    if (!sessionPick) return undefined;
    return { kind: "session", sessionId: sessionPick.sessionId };
  }

  return pick.scope;
}

// ── Filter builder ─────────────────────────────────────────────────────────

function buildFilter(
  scope: ExportScope,
  store: PersistentHistoryStore
): LogExportFilter | undefined {
  switch (scope.kind) {
    case "session":
      return { sessions: [scope.sessionId] };
    case "hours":
      return { since: Date.now() - scope.hours * 60 * 60 * 1000 };
    case "all":
      return {};
  }
}

// ── Export data assembly ───────────────────────────────────────────────────

function buildExportData(
  store: PersistentHistoryStore,
  filter: LogExportFilter
): LogExportResult {
  const logs = store.getLogs(filter);

  // Collect sessions referenced by logs + optionally filtered
  const sessionIds = new Set<string>();
  if (filter.sessions) {
    for (const id of filter.sessions) sessionIds.add(id);
  }
  for (const log of logs) {
    if (log.sessionId) sessionIds.add(log.sessionId);
  }

  const sessions = Array.from(sessionIds)
    .map((id) => store.getSession(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  return { sessions, logs };
}
