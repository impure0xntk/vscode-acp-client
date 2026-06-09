import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ============================================================================
// Types
// ============================================================================

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

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  toolCallsJson?: string;
  inlineFilePaths?: string[];
}

interface SessionMessages {
  messages: ChatMessage[];
  tokenUsage: { input: number; output: number; total: number };
}

interface SessionHistoryPanelProps {
  onRestore: (sessionId: string, agentId: string) => void;
  onClose: () => void;
}

type SortField = "updatedAt" | "messageCount" | "tokenUsage" | "title";
type SortDir = "asc" | "desc";

// ============================================================================
// VS Code API
// ============================================================================

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// ============================================================================
// Helpers
// ============================================================================

function groupByDate(entries: PersistentSessionEntry[]): Map<string, PersistentSessionEntry[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;

  const groups = new Map<string, PersistentSessionEntry[]>();

  for (const entry of entries) {
    const t = new Date(entry.updatedAt).getTime();
    let label: string;
    if (t >= today) label = "Today";
    else if (t >= yesterday) label = "Yesterday";
    else if (t >= weekAgo) label = "This Week";
    else label = "Older";

    const list = groups.get(label) ?? [];
    list.push(entry);
    groups.set(label, list);
  }

  return groups;
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
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

/** Highlight `<mark>` around query matches in text */
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

function exportAsJson(sessions: PersistentSessionEntry[], messages: Map<string, ChatMessage[]>): void {
  const data = sessions.map((s) => ({
    ...s,
    messages: messages.get(s.sessionId) ?? [],
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `session-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportAsMarkdown(sessions: PersistentSessionEntry[], messages: Map<string, ChatMessage[]>): string {
  let md = `# Session History Export\n\n${new Date().toLocaleString()}\n\n---\n\n`;
  for (const s of sessions) {
    md += `## ${s.title}\n\n`;
    md += `- **Agent:** ${s.agentId}\n`;
    md += `- **Status:** ${s.status}\n`;
    md += `- **Model:** ${s.model ?? "unknown"}\n`;
    md += `- **Created:** ${s.createdAt}\n`;
    md += `- **Updated:** ${s.updatedAt}\n`;
    md += `- **Messages:** ${s.messageCount}\n`;
    md += `- **Tokens:** ↑${s.tokenUsage.input} ↓${s.tokenUsage.output} (${s.tokenUsage.total} total)\n`;
    md += `- **CWD:** \`${s.cwd}\`\n\n`;
    const msgs = messages.get(s.sessionId) ?? [];
    for (const m of msgs) {
      md += `### ${m.role} — ${new Date(m.timestamp).toLocaleString()}\n\n`;
      md += `${m.content}\n\n`;
      if (m.inlineFilePaths?.length) {
        md += `> Inline files: ${m.inlineFilePaths.join(", ")}\n\n`;
      }
    }
    md += "---\n\n";
  }
  return md;
}

// ============================================================================
// Status indicator
// ============================================================================

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

// ============================================================================
// Token usage bar
// ============================================================================

function TokenBar({ entry }: { entry: PersistentSessionEntry }): React.ReactElement | null {
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
        {pct}% · {formatTokens(entry.tokenUsage.total)}/{formatTokens(entry.contextWindowMax)}
      </span>
    </div>
  );
}

// ============================================================================
// Session item row
// ============================================================================

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
          <span className="history-item-date" title={formatDate(entry.updatedAt)}>
            {formatRelativeTime(entry.updatedAt)}
          </span>
        </div>
        {entry.workspaceName && (
          <div className="history-item-workspace" title={entry.cwd}>
            📁 {highlightMatch(entry.workspaceName, query)}
          </div>
        )}
        <TokenBar entry={entry} />
      </div>
      <div className="history-item-stats">
        <span className="history-item-msgs">{entry.messageCount} msgs</span>
        <span className="history-item-tokens">
          ↑{formatTokens(entry.tokenUsage.input)} ↓{formatTokens(entry.tokenUsage.output)}
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
          {entry.isArchived ? "📦" : "📥"}
        </button>
        <button
          className="history-item-action-btn history-item-delete"
          onClick={onDelete}
          title="Delete session"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Session Detail Modal — full message view
// ============================================================================

function SessionDetailModal({
  session,
  messages,
  onRestore,
  onClose,
  query,
}: {
  session: PersistentSessionEntry;
  messages: ChatMessage[];
  onRestore: () => void;
  onClose: () => void;
  query: string;
}): React.ReactElement {
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set());
  const msgListRef = useRef<HTMLDivElement>(null);

  const toggleMsg = useCallback((id: string) => {
    setExpandedMsgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Auto-expand first 3 messages
  useEffect(() => {
    const initial = new Set(messages.slice(0, 3).map((m) => m.id));
    setExpandedMsgs(initial);
  }, [messages]);

  const pct = contextUsagePct(session.tokenUsage.total, session.contextWindowMax);

  return (
    <div className="history-modal-overlay" onClick={onClose}>
      <div className="history-modal history-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="history-modal-header">
          <h4>{session.title}</h4>
          <button className="history-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="history-modal-meta">
          <span>{session.agentId}</span>
          <span>{session.cwd}</span>
          <span>{formatDate(session.updatedAt)}</span>
          <span>{session.messageCount} messages</span>
          <span>
            ↑{formatTokens(session.tokenUsage.input)} ↓{formatTokens(session.tokenUsage.output)}
          </span>
        </div>
        {session.contextWindowMax != null && (
          <div className="history-modal-usage">
            <div className="history-token-bar history-token-bar-lg">
              <div
                className="history-token-bar-fill"
                style={{
                  width: `${pct}%`,
                  backgroundColor:
                    pct >= 90
                      ? "var(--vscode-terminal-ansiRed)"
                      : pct >= 70
                        ? "var(--vscode-terminal-ansiYellow)"
                        : "var(--vscode-terminal-ansiGreen)",
                }}
              />
            </div>
            <span className="history-token-bar-text">
              {pct}% context window · {formatTokens(session.tokenUsage.total)}/
              {formatTokens(session.contextWindowMax)} tokens
            </span>
          </div>
        )}
        <div className="history-modal-messages" ref={msgListRef}>
          {messages.length === 0 ? (
            <div className="history-modal-empty">No messages in this session.</div>
          ) : (
            messages.map((msg) => {
              const isExpanded = expandedMsgs.has(msg.id);
              return (
                <div
                  key={msg.id}
                  className={`history-message history-message-${msg.role}`}
                  onClick={() => toggleMsg(msg.id)}
                >
                  <div className="history-message-header">
                    <span className="history-message-role">{msg.role}</span>
                    <span className="history-message-time">
                      {new Date(msg.timestamp).toLocaleString()}
                    </span>
                    <span className="history-message-chevron">{isExpanded ? "▾" : "▸"}</span>
                  </div>
                  {isExpanded && (
                    <div className="history-message-content">{msg.content}</div>
                  )}
                  {!isExpanded && (
                    <div className="history-message-preview">
                      {msg.content.slice(0, 120)}
                      {msg.content.length > 120 ? "…" : ""}
                    </div>
                  )}
                  {msg.inlineFilePaths && msg.inlineFilePaths.length > 0 && isExpanded && (
                    <div className="history-message-files">
                      {msg.inlineFilePaths.map((fp) => (
                        <span key={fp} className="history-message-file">
                          📎 {fp}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="history-modal-footer">
          <button className="history-btn history-btn-primary" onClick={onRestore}>
            Restore Session
          </button>
          <button className="history-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Comparison view
// ============================================================================

function CompareBar({
  sessions,
  onClear,
}: {
  sessions: PersistentSessionEntry[];
  onClear: () => void;
}): React.ReactElement {
  if (sessions.length === 0) return <></>;

  const maxMsgs = Math.max(...sessions.map((s) => s.messageCount));
  const maxTokens = Math.max(...sessions.map((s) => s.tokenUsage.total));
  const maxCtx = Math.max(
    ...sessions.map((s) => (s.contextWindowMax ? s.tokenUsage.total / s.contextWindowMax : 0))
  );

  return (
    <div className="history-compare">
      <div className="history-compare-header">
        <span>Comparing {sessions.length} sessions</span>
        <button className="history-btn history-btn-sm" onClick={onClear}>
          Clear
        </button>
      </div>
      <table className="history-compare-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Agent</th>
            <th>Messages</th>
            <th>Tokens</th>
            <th>Context %</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const ctxPct = contextUsagePct(s.tokenUsage.total, s.contextWindowMax);
            return (
              <tr key={s.sessionId}>
                <td title={s.title} className="history-compare-title">
                  {s.title}
                </td>
                <td>{s.agentId}</td>
                <td>
                  <div className="history-compare-bar-cell">
                    <div
                      className="history-compare-bar"
                      style={{
                        width: `${maxMsgs > 0 ? (s.messageCount / maxMsgs) * 100 : 0}%`,
                      }}
                    />
                    <span>{s.messageCount}</span>
                  </div>
                </td>
                <td>
                  <div className="history-compare-bar-cell">
                    <div
                      className="history-compare-bar"
                      style={{
                        width: `${maxTokens > 0 ? (s.tokenUsage.total / maxTokens) * 100 : 0}%`,
                      }}
                    />
                    <span>{formatTokens(s.tokenUsage.total)}</span>
                  </div>
                </td>
                <td>
                  <div className="history-compare-bar-cell">
                    <div
                      className="history-compare-bar"
                      style={{
                        width: `${maxCtx > 0 ? (ctxPct / (maxCtx * 100)) * 100 : 0}%`,
                        backgroundColor:
                          ctxPct >= 90
                            ? "var(--vscode-terminal-ansiRed)"
                            : ctxPct >= 70
                              ? "var(--vscode-terminal-ansiYellow)"
                              : "var(--vscode-terminal-ansiGreen)",
                      }}
                    />
                    <span>{ctxPct}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Sort controls
// ============================================================================

function SortControls({
  field,
  dir,
  onChange,
}: {
  field: SortField;
  dir: SortDir;
  onChange: (field: SortField, dir: SortDir) => void;
}): React.ReactElement {
  return (
    <div className="history-sort">
      <select
        className="history-sort-select"
        value={field}
        onChange={(e) => onChange(e.target.value as SortField, dir)}
      >
        <option value="updatedAt">Date</option>
        <option value="messageCount">Messages</option>
        <option value="tokenUsage">Tokens</option>
        <option value="title">Title</option>
      </select>
      <button
        className="history-sort-dir"
        onClick={() => onChange(field, dir === "asc" ? "desc" : "asc")}
        title={dir === "asc" ? "Ascending" : "Descending"}
      >
        {dir === "asc" ? "↑" : "↓"}
      </button>
    </div>
  );
}

// ============================================================================
// SessionHistoryPanel Component
// ============================================================================

const PAGE_SIZE = 50;

export function SessionHistoryPanel({
  onRestore,
  onClose,
}: SessionHistoryPanelProps): React.ReactElement {
  const vscode = useMemo(() => acquireVsCodeApi(), []);
  const [sessions, setSessions] = useState<PersistentSessionEntry[]>([]);
  const [query, setQuery] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [selectedSession, setSelectedSession] = useState<PersistentSessionEntry | null>(null);
  const [sessionMessages, setSessionMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<{
    totalSessions: number;
    totalMessages: number;
    oldestSession: string | null;
  } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [allMessages, setAllMessages] = useState<Map<string, ChatMessage[]>>(new Map());

  // Listen for messages from extension host
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg?.type) return;

      switch (msg.type) {
        case "history:allSessions":
          setSessions(msg.sessions as PersistentSessionEntry[]);
          break;
        case "history:searchResults":
          setSessions(msg.results as PersistentSessionEntry[]);
          break;
        case "history:sessionDetail": {
          const msgs = msg.messages as ChatMessage[];
          setSessionMessages(msgs);
          if (msg.sessionId) {
            setAllMessages((prev) => {
              const next = new Map(prev);
              next.set(msg.sessionId as string, msgs);
              return next;
            });
          }
          setIsLoading(false);
          break;
        }
        case "history:archived":
        case "history:unarchived":
          // Refresh list
          vscode.postMessage({ type: "history:getAll" });
          break;
        case "history:deleted":
          setSessions((prev) => prev.filter((s) => s.sessionId !== msg.sessionId));
          setSessionMessages([]);
          break;
        case "history:stats":
          setStats({
            totalSessions: msg.totalSessions,
            totalMessages: msg.totalMessages,
            oldestSession: msg.oldestSession ?? null,
          });
          break;
        case "history:cleanupComplete":
          vscode.postMessage({ type: "history:getAll" });
          break;
        case "history:exportMd": {
          const md = msg.markdown as string;
          const blob = new Blob([md], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `session-history-${new Date().toISOString().slice(0, 10)}.md`;
          a.click();
          URL.revokeObjectURL(url);
          break;
        }
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "history:getAll" });
    vscode.postMessage({ type: "history:getStats" });
    return () => window.removeEventListener("message", handler);
  }, [vscode]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        vscode.postMessage({ type: "history:search", query: query.trim() });
      } else {
        vscode.postMessage({ type: "history:getAll" });
      }
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, vscode]);

  // Filter sessions by agent and archive status
  const filtered = useMemo(() => {
    let result = sessions;
    if (selectedAgent !== "all") {
      result = result.filter((s) => s.agentId === selectedAgent);
    }
    if (!showArchived) {
      result = result.filter((s) => !s.isArchived);
    }
    return result;
  }, [sessions, selectedAgent, showArchived]);

  // Sort
  const sorted = useMemo(() => {
    const sortedCopy = [...filtered];
    sortedCopy.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "updatedAt":
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case "messageCount":
          cmp = a.messageCount - b.messageCount;
          break;
        case "tokenUsage":
          cmp = a.tokenUsage.total - b.tokenUsage.total;
          break;
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sortedCopy;
  }, [filtered, sortField, sortDir]);

  // Paginate
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, page]);

  const grouped = useMemo(() => groupByDate(paged), [paged]);

  const archivedCount = useMemo(
    () => sessions.filter((s) => s.isArchived).length,
    [sessions]
  );

  const agents = useMemo(() => {
    const set = new Set(sessions.map((s) => s.agentId));
    return ["all", ...Array.from(set)];
  }, [sessions]);

  const compareList = useMemo(() => {
    return sessions.filter((s) => compareSet.has(s.sessionId));
  }, [sessions, compareSet]);

  const handleSessionClick = useCallback(
    (session: PersistentSessionEntry) => {
      setSelectedSession(session);
      setIsLoading(true);
      // Check if already loaded
      if (allMessages.has(session.sessionId)) {
        setSessionMessages(allMessages.get(session.sessionId)!);
        setIsLoading(false);
      } else {
        vscode.postMessage({ type: "history:getSession", sessionId: session.sessionId });
      }
    },
    [vscode, allMessages]
  );

  const handleRestore = useCallback(
    (sessionId: string, agentId: string) => {
      onRestore(sessionId, agentId);
      setSelectedSession(null);
    },
    [onRestore]
  );

  const handleDelete = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirm("Delete this session history?")) {
        vscode.postMessage({ type: "history:delete", sessionId });
        setCompareSet((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      }
    },
    [vscode]
  );

  const handleArchive = useCallback(
    (sessionId: string, isArchived: boolean) => {
      vscode.postMessage({
        type: isArchived ? "history:unarchive" : "history:archive",
        sessionId,
      });
    },
    [vscode]
  );

  const handleCleanup = useCallback(() => {
    const days = prompt("Delete sessions older than how many days?", "90");
    if (days) {
      vscode.postMessage({ type: "history:cleanup", maxAgeDays: parseInt(days, 10) });
    }
  }, [vscode]);

  const handleExportJson = useCallback(() => {
    exportAsJson(paged, allMessages);
  }, [paged, allMessages]);

  const handleExportMarkdown = useCallback(() => {
    const md = exportAsMarkdown(paged, allMessages);
    // Send to extension host for native clipboard / download
    vscode.postMessage({ type: "history:exportMd", markdown: md });
  }, [vscode, paged, allMessages]);

  const handleToggleCompare = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setCompareSet((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) {
          next.delete(sessionId);
        } else if (next.size >= 4) {
          alert("Maximum 4 sessions can be compared at once.");
        } else {
          next.add(sessionId);
        }
        return next;
      });
    },
    []
  );

  return (
    <div className="session-history-panel">
      {/* Header */}
      <div className="history-header">
        <h3 className="history-title">Session History</h3>
        <div className="history-header-actions">
          <button className="history-btn" onClick={handleExportJson} title="Export as JSON">
            📤 JSON
          </button>
          <button className="history-btn" onClick={handleExportMarkdown} title="Export as Markdown">
            📄 MD
          </button>
          <button className="history-close-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      {/* Search + Filter Row */}
      <div className="history-toolbar">
        <input
          type="text"
          className="history-search-input"
          placeholder="Search sessions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="history-agent-filter"
          value={selectedAgent}
          onChange={(e) => {
            setSelectedAgent(e.target.value);
            setPage(1);
          }}
        >
          {agents.map((a) => (
            <option key={a} value={a}>
              {a === "all" ? "All agents" : a}
            </option>
          ))}
        </select>
        <SortControls
          field={sortField}
          dir={sortDir}
          onChange={(f, d) => {
            setSortField(f);
            setSortDir(d);
          }}
        />
      </div>

      {/* Stats + Archive toggle */}
      <div className="history-stats">
        <span>{stats?.totalSessions ?? 0} sessions</span>
        <span>{stats?.totalMessages ?? 0} messages</span>
        {stats?.oldestSession && (
          <span className="history-stats-oldest">
            Since {new Date(stats.oldestSession).toLocaleDateString()}
          </span>
        )}
        <label className="history-archive-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => {
              setShowArchived(e.target.checked);
              setPage(1);
            }}
          />
          Show archived ({archivedCount})
        </label>
      </div>

      {/* Comparison view */}
      {compareList.length > 0 && (
        <CompareBar
          sessions={compareList}
          onClear={() => setCompareSet(new Set())}
        />
      )}

      {/* Results */}
      <div className="history-list">
        {paged.length === 0 ? (
          <div className="history-empty">
            {query ? "No matching sessions found." : "No session history yet."}
          </div>
        ) : (
          Array.from(grouped.entries()).map(([groupLabel, groupEntries]) => (
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
                  onClick={() => handleSessionClick(entry)}
                  onArchive={() => handleArchive(entry.sessionId, entry.isArchived)}
                  onDelete={(e) => handleDelete(entry.sessionId, e)}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="history-pagination">
          <button
            className="history-page-btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ←
          </button>
          <span className="history-page-info">
            {page} / {totalPages}
          </span>
          <button
            className="history-page-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            →
          </button>
          <span className="history-page-total">
            {sorted.length} sessions total
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="history-footer">
        <div className="history-footer-actions">
          <button className="history-btn" onClick={handleCleanup}>
            Cleanup old
          </button>
        </div>
      </div>

      {/* Session Detail Modal */}
      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          messages={sessionMessages}
          onRestore={() =>
            handleRestore(selectedSession.sessionId, selectedSession.agentId)
          }
          onClose={() => setSelectedSession(null)}
          query={query}
        />
      )}

      {/* Loading overlay */}
      {isLoading && selectedSession && (
        <div className="history-loading">Loading messages…</div>
      )}
    </div>
  );
}
