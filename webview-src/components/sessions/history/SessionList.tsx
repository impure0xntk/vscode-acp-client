import React from "react";
import { Icon } from "../../../lib/icons";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PersistentSessionEntry {
  sessionId: string;
  agentId: string;
  title: string;
  cwd: string;
  model: string | null;
  mode: string | null;
  status: string;
  workspaceName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Last time the agent produced output (message/stream/streamEnd). Null if no output yet. */
  lastResponseAt: string | null;
  messageCount: number;
  tokenUsage: { input: number; output: number; total: number };
  contextWindowMax: number | null;
  isArchived: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function contextUsagePct(usage: number, max: number | null): number {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.round((usage / max) * 100));
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part) ? (
      <mark key={i} className="bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] text-[var(--fg-primary)] rounded-[2px] px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

// ── Status indicator ────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }): React.ReactElement {
  const color =
    status === "running"
      ? "var(--vscode-terminal-ansiGreen)"
      : status === "error"
        ? "var(--vscode-terminal-ansiRed)"
        : status === "cancelled"
          ? "var(--vscode-terminal-ansiYellow)"
          : "var(--vscode-terminal-ansiBlue)";
  return (
    <span
      className="shrink-0 w-2 h-2 rounded-full mt-1"
      style={{ backgroundColor: color }}
      title={status}
    />
  );
}

// ── Token usage bar ────────────────────────────────────────────────────────

function TokenBar({
  entry,
}: {
  entry: PersistentSessionEntry;
}): React.ReactElement | null {
  const pct = contextUsagePct(entry.tokenUsage.total, entry.contextWindowMax);
  if (!entry.contextWindowMax) return null;

  const color =
    pct >= 90
      ? "var(--vscode-terminal-ansiRed)"
      : pct >= 70
        ? "var(--vscode-terminal-ansiYellow)"
        : "var(--vscode-terminal-ansiGreen)";

  return (
    <div
      className="relative h-[3px] rounded-[2px] mt-[3px] bg-[color-mix(in_srgb,var(--fg-muted)_15%,transparent)]"
      title={`${pct}% of context window used`}
    >
      <div
        className="h-full rounded-[2px] transition-[width] duration-300"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
      <span className="absolute right-0 -top-3 text-[9px] text-[var(--fg-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {pct}% · {formatTokens(entry.tokenUsage.total)}/
        {formatTokens(entry.contextWindowMax)}
      </span>
    </div>
  );
}

// ── Session Row ─────────────────────────────────────────────────────────────

function SessionRow({
  entry,
  query,
  onClick,
  onArchive,
  onDelete,
}: {
  entry: PersistentSessionEntry;
  query: string;
  onClick: () => void;
  onArchive: () => void;
  onDelete: (e: React.MouseEvent) => void;
}): React.ReactElement {
  return (
    <div
      className={`group flex items-start gap-2 px-2.5 py-1.5 cursor-pointer transition-colors duration-100 hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-1px] ${
        entry.isArchived ? "opacity-50" : ""
      }`}
      onClick={onClick}
    >
      <StatusDot status={entry.status} />
      <div className="flex-1 min-w-0 overflow-hidden">
        <div
          className={`text-xs font-medium text-[var(--fg-primary)] overflow-hidden text-ellipsis whitespace-nowrap ${
            entry.isArchived ? "line-through" : ""
          }`}
          title={entry.title}
        >
          {highlightMatch(entry.title, query)}
        </div>
        <div className="flex items-center gap-1.5 mt-px">
          <span className="text-[10px] text-[var(--fg-secondary)]">
            {entry.agentId}
          </span>
          <span
            className="text-[10px] text-[var(--fg-muted)]"
            title={formatDate(entry.createdAt)}
          >
            {formatRelativeTime(entry.lastResponseAt ?? entry.createdAt)}
          </span>
        </div>
        {entry.workspaceName && (
          <div
            className="text-[10px] text-[var(--fg-muted)] overflow-hidden text-ellipsis whitespace-nowrap"
            title={entry.cwd}
          >
            <Icon name="folder-opened" size="sm" />{" "}
            {highlightMatch(entry.workspaceName, query)}
          </div>
        )}
        <TokenBar entry={entry} />
      </div>
      <div className="flex flex-col items-end gap-px shrink-0">
        <span className="whitespace-nowrap text-[10px] text-[var(--fg-muted)]">
          {entry.messageCount} msgs
        </span>
        <span className="whitespace-nowrap font-[var(--font-mono)] text-[9px] text-[var(--fg-muted)]">
          ↑{formatTokens(entry.tokenUsage.input)} ↓
          {formatTokens(entry.tokenUsage.output)}
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <button
          className="flex items-center justify-center w-5 h-5 p-0 border-none rounded bg-transparent text-[var(--fg-muted)] cursor-pointer transition-colors duration-150 hover:bg-[var(--accent-hover)] hover:text-[var(--fg-primary)]"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          title={entry.isArchived ? "Unarchive" : "Archive"}
        >
          {entry.isArchived ? (
            <Icon name="archive" size="sm" />
          ) : (
            <Icon name="save" size="sm" />
          )}
        </button>
        <button
          className="flex items-center justify-center w-5 h-5 p-0 border-none rounded bg-transparent text-[var(--fg-muted)] cursor-pointer transition-colors duration-150 hover:!bg-[var(--error)] hover:!text-[var(--user-fg)]"
          onClick={onDelete}
          title="Delete session"
        >
          <Icon name="close" size="sm" />
        </button>
      </div>
    </div>
  );
}

// ── Session List ────────────────────────────────────────────────────────────

export interface SessionListProps {
  grouped: Map<string, PersistentSessionEntry[]>;
  query: string;
  onSessionClick: (session: PersistentSessionEntry) => void;
  onArchive: (sessionId: string, isArchived: boolean) => void;
  onDelete: (sessionId: string, e: React.MouseEvent) => void;
}

export function SessionList({
  grouped,
  query,
  onSessionClick,
  onArchive,
  onDelete,
}: SessionListProps): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {Array.from(grouped.entries()).map(([groupLabel, groupEntries]) => (
        <div key={groupLabel} className="py-0.5">
          <div className="flex items-center justify-between px-3 py-1 text-[10px] text-[var(--fg-muted)]">
            {groupLabel}
            <span className="text-[var(--fg-muted)] opacity-60 font-normal">
              {groupEntries.length}
            </span>
          </div>
          {groupEntries.map((entry) => (
            <SessionRow
              key={entry.sessionId}
              entry={entry}
              query={query}
              onClick={() => onSessionClick(entry)}
              onArchive={() => onArchive(entry.sessionId, entry.isArchived)}
              onDelete={(e) => onDelete(entry.sessionId, e)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
