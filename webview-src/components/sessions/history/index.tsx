import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Icon } from "../../../lib/icons";
import { SearchBar, type SortField, type SortDir } from "./SearchBar";
import { SessionList, type PersistentSessionEntry } from "./SessionList";
import { DetailModal } from "./DetailModal";
import { CompareBar } from "./CompareView";
import { groupByDate, exportAsJson, exportAsMarkdown } from "./formatting";
import type { ChatMessage } from "./DetailModal";

export type { PersistentSessionEntry } from "./SessionList";
export type { ChatMessage } from "./DetailModal";

interface SessionHistoryPanelProps {
  onRestore: (sessionId: string, agentId: string) => void;
  onClose: () => void;
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const PAGE_SIZE = 50;

export function SessionHistoryPanel({
  onRestore,
  onClose,
}: SessionHistoryPanelProps): React.ReactElement {
  const vscode = useMemo(() => acquireVsCodeApi(), []);
  const [sessions, setSessions] = useState<PersistentSessionEntry[]>([]);
  const [query, setQuery] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [selectedSession, setSelectedSession] =
    useState<PersistentSessionEntry | null>(null);
  const [sessionMessages, setSessionMessages] = useState<
    import("./DetailModal").ChatMessage[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<{
    totalSessions: number;
    totalMessages: number;
    oldestSession: string | null;
  } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [allMessages, setAllMessages] = useState<
    Map<string, import("./DetailModal").ChatMessage[]>
  >(new Map());

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
          const msgs = msg.messages as import("./DetailModal").ChatMessage[];
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
          vscode.postMessage({ type: "history:getAll" });
          break;
        case "history:deleted":
          setSessions((prev) =>
            prev.filter((s) => s.sessionId !== msg.sessionId)
          );
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

  const sorted = useMemo(() => {
    const sortedCopy = [...filtered];
    sortedCopy.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "createdAt":
          cmp =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
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

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, page]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

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
      if (allMessages.has(session.sessionId)) {
        setSessionMessages(allMessages.get(session.sessionId)!);
        setIsLoading(false);
      } else {
        vscode.postMessage({
          type: "history:getSession",
          sessionId: session.sessionId,
        });
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
      vscode.postMessage({
        type: "history:cleanup",
        maxAgeDays: parseInt(days, 10),
      });
    }
  }, [vscode]);

  const handleExportJson = useCallback(() => {
    exportAsJson(paged, allMessages);
  }, [paged, allMessages]);

  const handleExportMarkdown = useCallback(() => {
    const md = exportAsMarkdown(paged, allMessages);
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
    <div className="flex flex-col h-screen overflow-hidden bg-bg-primary text-fg-primary text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <h3 className="text-[13px] font-semibold m-0">Session History</h3>
        <div className="flex items-center gap-1">
          <button
            className="px-2 py-[3px] border border-border rounded bg-bg-input text-fg-primary text-[11px] cursor-pointer transition-colors duration-150 whitespace-nowrap"
            onClick={handleExportJson}
            title="Export as JSON"
          >
            <Icon name="desktop-download" size="sm" /> JSON
          </button>
          <button
            className="px-2 py-[3px] border border-border rounded bg-bg-input text-fg-primary text-[11px] cursor-pointer transition-colors duration-150 whitespace-nowrap"
            onClick={handleExportMarkdown}
            title="Export as Markdown"
          >
            <Icon name="file" size="sm" /> MD
          </button>
          <button
            className="flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-fg-secondary text-base cursor-pointer transition-colors duration-150 hover:bg-error hover:text-user-fg"
            onClick={onClose}
            title="Close"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      </div>

      {/* Search + Filter Row */}
      <SearchBar
        query={query}
        onQueryChange={setQuery}
        selectedAgent={selectedAgent}
        agents={agents}
        onAgentChange={(agent) => {
          setSelectedAgent(agent);
          setPage(1);
        }}
        sortField={sortField}
        sortDir={sortDir}
        onSortChange={(f, d) => {
          setSortField(f);
          setSortDir(d);
        }}
      />

      {/* Stats + Archive toggle */}
      <div className="flex items-center gap-[10px] px-2.5 py-1 border-b border-border text-[10px] text-fg-muted shrink-0">
        <span>{stats?.totalSessions ?? 0} sessions</span>
        <span>{stats?.totalMessages ?? 0} messages</span>
        {stats?.oldestSession && (
          <span className="opacity-70">
            Since {new Date(stats.oldestSession).toLocaleDateString()}
          </span>
        )}
        <label className="flex items-center gap-1 ml-auto cursor-pointer text-[10px]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => {
              setShowArchived(e.target.checked);
              setPage(1);
            }}
            style={{ accentColor: "var(--accent)" }}
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
      {paged.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-xs text-fg-muted">
          {query ? "No matching sessions found." : "No session history yet."}
        </div>
      ) : (
        <SessionList
          grouped={grouped}
          query={query}
          onSessionClick={handleSessionClick}
          onArchive={handleArchive}
          onDelete={handleDelete}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-2.5 py-[6px] border-t border-border shrink-0">
          <button
            className="flex items-center justify-center w-7 h-6 p-0 border border-border rounded bg-bg-input text-fg-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ←
          </button>
          <span className="text-[11px] text-fg-muted font-[var(--font-mono)]">
            {page} / {totalPages}
          </span>
          <button
            className="flex items-center justify-center w-7 h-6 p-0 border border-border rounded bg-bg-input text-fg-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            →
          </button>
          <span className="text-[10px] text-fg-muted opacity-60">
            {sorted.length} sessions total
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-2.5 py-1 border-t border-border shrink-0">
        <div className="flex gap-1">
          <button
            className="px-2 py-[3px] border border-border rounded bg-bg-input text-fg-primary text-[11px] cursor-pointer transition-colors duration-150 whitespace-nowrap"
            onClick={handleCleanup}
          >
            Cleanup old
          </button>
        </div>
      </div>

      {/* Session Detail Modal */}
      {selectedSession && (
        <DetailModal
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
