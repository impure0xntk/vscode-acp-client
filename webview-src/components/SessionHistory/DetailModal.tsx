import React, { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "../../lib/icons";

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
    <div className="history-modal-overlay" onClick={onClose}>
      <div
        className="history-modal history-modal-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="history-modal-header">
          <h4>{session.title}</h4>
          <button className="history-modal-close" onClick={onClose}>
            <Icon name="close" size="sm" />
          </button>
        </div>
        <div className="history-modal-meta">
          <span>{session.agentId}</span>
          <span>{session.cwd}</span>
          <span>{formatDate(session.createdAt)}</span>
          <span>{session.messageCount} messages</span>
          <span>
            ↑{formatTokens(session.tokenUsage.input)} ↓
            {formatTokens(session.tokenUsage.output)}
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
            <div className="history-modal-empty">
              No messages in this session.
            </div>
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
                    <span className="history-message-chevron">
                      {isExpanded ? "▾" : "▸"}
                    </span>
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
                  {msg.inlineFilePaths &&
                    msg.inlineFilePaths.length > 0 &&
                    isExpanded && (
                      <div className="history-message-files">
                        {msg.inlineFilePaths.map((fp) => (
                          <span key={fp} className="history-message-file">
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
        <div className="history-modal-footer">
          <button
            className="history-btn history-btn-primary"
            onClick={onRestore}
          >
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
