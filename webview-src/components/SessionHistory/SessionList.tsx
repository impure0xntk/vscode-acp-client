import React from "react";
import { Icon } from "../../lib/icons";

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
  messageCount: number;
  tokenUsage: { input: number; output: number; total: number };
  contextWindowMax: number | null;
  isArchived: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
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

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function contextUsagePct(usage: number, max: number | null): number {
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
      <mark key={i} className="history-highlight">
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
      className="history-status-dot"
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
    <div className="history-token-bar" title={`${pct}% of context window used`}>
      <div
        className="history-token-bar-fill"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
      <span className="history-token-bar-label">
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
      className={`history-item ${entry.isArchived ? "history-item-archived" : ""}`}
      onClick={onClick}
    >
      <StatusDot status={entry.status} />
      <div className="history-item-main">
        <div className="history-item-title" title={entry.title}>
          {highlightMatch(entry.title, query)}
        </div>
        <div className="history-item-meta">
          <span className="history-item-agent">{entry.agentId}</span>
          <span
            className="history-item-date"
            title={formatDate(entry.updatedAt)}
          >
            {formatRelativeTime(entry.updatedAt)}
          </span>
        </div>
        {entry.workspaceName && (
          <div className="history-item-workspace" title={entry.cwd}>
            <Icon name="folder-opened" size="sm" /> {highlightMatch(entry.workspaceName, query)}
          </div>
        )}
        <TokenBar entry={entry} />
      </div>
      <div className="history-item-stats">
        <span className="history-item-msgs">{entry.messageCount} msgs</span>
        <span className="history-item-tokens">
          ↑{formatTokens(entry.tokenUsage.input)} ↓
          {formatTokens(entry.tokenUsage.output)}
        </span>
      </div>
      <div className="history-item-actions">
        <button
          className="history-item-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          title={entry.isArchived ? "Unarchive" : "Archive"}
        >
          {entry.isArchived ? <Icon name="archive" size="sm" /> : <Icon name="save" size="sm" />}
        </button>
        <button
          className="history-item-action-btn history-item-delete"
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
    <div className="history-list">
      {Array.from(grouped.entries()).map(([groupLabel, groupEntries]) => (
        <div key={groupLabel} className="history-group">
          <div className="history-group-header">
            {groupLabel}
            <span className="history-group-count">
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
