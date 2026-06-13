import React from "react";

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

function contextUsagePct(usage: number, max: number | null): number {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.round((usage / max) * 100));
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Compare View ────────────────────────────────────────────────────────────

export function CompareBar({
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
    ...sessions.map((s) =>
      s.contextWindowMax ? s.tokenUsage.total / s.contextWindowMax : 0
    )
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
            const ctxPct = contextUsagePct(
              s.tokenUsage.total,
              s.contextWindowMax
            );
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
