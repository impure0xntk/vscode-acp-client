import React, { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "../../../lib/icons";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  toolCallsJson?: string;
  inlineFilePaths?: string[];
}

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
  lastResponseAt: string | null;
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

function contextUsagePct(usage: number, max: number | null): number {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.round((usage / max) * 100));
}

// ── Detail Modal ────────────────────────────────────────────────────────────

export function DetailModal({
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

  useEffect(() => {
    const initial = new Set(messages.slice(0, 3).map((m) => m.id));
    setExpandedMsgs(initial);
  }, [messages]);

  const pct = contextUsagePct(
    session.tokenUsage.total,
    session.contextWindowMax
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] animate-[modal-fade-in_0.15s_ease-out]" onClick={onClose}>
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg w-[90%] max-w-[760px] max-h-[85vh] flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-[modal-slide-in_0.15s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <h4 className="m-0 text-sm font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{session.title}</h4>
          <button
            className="flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-[var(--fg-secondary)] text-base cursor-pointer transition-colors hover:bg-[var(--error)] hover:text-[var(--user-fg)]"
            onClick={onClose}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-[var(--border)] text-[11px] text-[var(--fg-muted)] shrink-0">
          <span className="bg-[var(--bg-input)] px-1.5 py-0.5 rounded">{session.agentId}</span>
          <span className="bg-[var(--bg-input)] px-1.5 py-0.5 rounded">{session.cwd}</span>
          <span className="bg-[var(--bg-input)] px-1.5 py-0.5 rounded">{formatDate(session.createdAt)}</span>
          <span className="bg-[var(--bg-input)] px-1.5 py-0.5 rounded">{session.messageCount} messages</span>
          <span className="bg-[var(--bg-input)] px-1.5 py-0.5 rounded">
            ↑{formatTokens(session.tokenUsage.input)} ↓
            {formatTokens(session.tokenUsage.output)}
          </span>
        </div>
        {session.contextWindowMax != null && (
          <div className="px-4 py-1.5 border-b border-[var(--border)] shrink-0">
            <div className="relative h-1.5 rounded-[2px] bg-[color-mix(in_srgb,var(--fg-muted)_15%,transparent)] my-1 overflow-hidden">
              <div
                className="h-full rounded-[2px] transition-[width] duration-300"
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
            <span className="text-[10px] text-[var(--fg-muted)]">
              {pct}% context window · {formatTokens(session.tokenUsage.total)}/
              {formatTokens(session.contextWindowMax)} tokens
            </span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-2" ref={msgListRef}>
          {messages.length === 0 ? (
            <div className="py-6 text-center text-[var(--fg-muted)] text-xs">
              No messages in this session.
            </div>
          ) : (
            messages.map((msg) => {
              const isExpanded = expandedMsgs.has(msg.id);
              const roleBg =
                msg.role === "user"
                  ? "bg-[color-mix(in_srgb,var(--user-bubble)_8%,transparent)] border-l-2 border-l-[var(--user-bubble)]"
                  : msg.role === "tool"
                    ? "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] border-l-2 border-l-[var(--accent)]"
                    : "bg-transparent border-l-2 border-l-transparent";
              return (
                <div
                  key={msg.id}
                  className={`p-1.5 rounded mb-1 cursor-pointer transition-colors hover:bg-[var(--accent-hover)] ${roleBg}`}
                  onClick={() => toggleMsg(msg.id)}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider">{msg.role}</span>
                    <span className="text-[9px] text-[var(--fg-muted)] font-[var(--font-mono)]">
                      {new Date(msg.timestamp).toLocaleString()}
                    </span>
                    <span className="ml-auto text-[9px] text-[var(--fg-muted)]">
                      {isExpanded ? "▾" : "▸"}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="text-xs leading-relaxed text-[var(--fg-primary)] whitespace-pre-wrap break-words font-[var(--font-mono)]">{msg.content}</div>
                  )}
                  {!isExpanded && (
                    <div className="text-[11px] text-[var(--fg-muted)] overflow-hidden text-ellipsis whitespace-nowrap">
                      {msg.content.slice(0, 120)}
                      {msg.content.length > 120 ? "…" : ""}
                    </div>
                  )}
                  {msg.inlineFilePaths &&
                    msg.inlineFilePaths.length > 0 &&
                    isExpanded && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {msg.inlineFilePaths.map((fp) => (
                          <span key={fp} className="text-[10px] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-1 py-0.5 rounded font-[var(--font-mono)]">
                            <Icon name="paperclip" size="sm" /> {fp}
                          </span>
                        ))}
                      </div>
                    )}
                </div>
              );
            })
          )}
        </div>
        <div className="flex justify-end gap-1.5 px-4 py-2 border-t border-[var(--border)] shrink-0">
          <button
            className="px-2 py-0.5 border border-[var(--accent)] rounded bg-[var(--accent)] text-[var(--user-fg)] text-[11px] cursor-pointer whitespace-nowrap hover:bg-[color-mix(in_srgb,var(--accent)_80%,white)]"
            onClick={onRestore}
          >
            Restore Session
          </button>
          <button
            className="px-2 py-0.5 border border-[var(--border)] rounded bg-[var(--bg-input)] text-[var(--fg-primary)] text-[11px] cursor-pointer whitespace-nowrap hover:bg-[var(--accent-hover)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
