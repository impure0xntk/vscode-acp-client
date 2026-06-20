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
    <div className="border-b border-[var(--border)] px-2.5 py-2 bg-[var(--bg-secondary)] shrink-0">
      <div className="flex items-center justify-between mb-1.5 text-[11px] text-[var(--fg-secondary)]">
        <span>Comparing {sessions.length} sessions</span>
        <button
          className="px-1.5 py-0.5 text-[10px] border border-[var(--border)] rounded bg-[var(--bg-input)] text-[var(--fg-primary)] cursor-pointer whitespace-nowrap hover:bg-[var(--accent-hover)]"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="text-left p-1.5 text-[10px] text-[var(--fg-muted)] font-semibold uppercase tracking-wider border-b border-[var(--border)]">Title</th>
            <th className="text-left p-1.5 text-[10px] text-[var(--fg-muted)] font-semibold uppercase tracking-wider border-b border-[var(--border)]">Agent</th>
            <th className="text-left p-1.5 text-[10px] text-[var(--fg-muted)] font-semibold uppercase tracking-wider border-b border-[var(--border)]">Messages</th>
            <th className="text-left p-1.5 text-[10px] text-[var(--fg-muted)] font-semibold uppercase tracking-wider border-b border-[var(--border)]">Tokens</th>
            <th className="text-left p-1.5 text-[10px] text-[var(--fg-muted)] font-semibold uppercase tracking-wider border-b border-[var(--border)]">Context %</th>
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
                <td title={s.title} className="p-1.5 text-[var(--fg-primary)] max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                  {s.title}
                </td>
                <td className="p-1.5 text-[var(--fg-primary)]">{s.agentId}</td>
                <td>
                  <div className="flex items-center gap-1 relative pl-[60px] min-w-0">
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-[3px] bg-[var(--accent)] opacity-50 max-w-[56px]"
                      style={{
                        width: `${maxMsgs > 0 ? (s.messageCount / maxMsgs) * 100 : 0}%`,
                      }}
                    />
                    <span className="text-[10px] text-[var(--fg-muted)] shrink-0 z-10">{s.messageCount}</span>
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-1 relative pl-[60px] min-w-0">
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-[3px] bg-[var(--accent)] opacity-50 max-w-[56px]"
                      style={{
                        width: `${maxTokens > 0 ? (s.tokenUsage.total / maxTokens) * 100 : 0}%`,
                      }}
                    />
                    <span className="text-[10px] text-[var(--fg-muted)] shrink-0 z-10">{formatTokens(s.tokenUsage.total)}</span>
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-1 relative pl-[60px] min-w-0">
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-[3px] opacity-50 max-w-[56px]"
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
                    <span className="text-[10px] text-[var(--fg-muted)] shrink-0 z-10">{ctxPct}%</span>
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
