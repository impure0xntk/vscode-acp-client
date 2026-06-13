import React from "react";
import type { AgentInfo, SessionTabStatus } from "../../hooks/useSessionContext";
import type { ToolbarMeta, ContextColor } from "../ui/Chip";
import { Chip } from "../ui/Chip";
import { fmt, fmtDuration, visualBar, contextColor, StatuslineInfo, statuslinePrefix, statuslineChips } from "./formatting";
import { AgentSection, MetricsSection, SessionIdRow } from "./DetailSections";

export type { ToolbarMeta, ContextColor };
export { fmt, visualBar, contextColor };
export type { StatuslineInfo };

// ── Props ──────────────────────────────────────────────────────────────────

export interface DetailsPanelProps {
  mode?: string;
  model?: string;
  cwd?: string;
  messageCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
  totalTokens: number;
  isTurnActive: boolean;
  sessionStatus?: string;
  agentInfo?: AgentInfo;
  meta?: ToolbarMeta[];
  sessionId?: string;
  sessionStartMs?: number;
  provider?: string;
  maxTokens?: number;
  onForkSession?: () => void;
}

const CAT_LABEL: Record<string, string> = {
  session: "Session",
  runtime: "Runtime",
  metrics: "Metrics",
  workspace: "Workspace",
};

// ── DetailsPanel ───────────────────────────────────────────────────────────

export function DetailsPanel(p: DetailsPanelProps): React.ReactElement {
  const builtins: ToolbarMeta[] = [];
  if (p.sessionStatus)
    builtins.push({ key: "status", label: "Status", value: p.sessionStatus, category: "session" });
  if (p.sessionId)
    builtins.push({ key: "sid", label: "Session", value: p.sessionId.slice(0, 8) + "...", category: "session" });
  if (p.isTurnActive)
    builtins.push({ key: "turn", label: "Turn", value: "Active", category: "session" });

  const runtime: ToolbarMeta[] = [];
  if (p.mode) runtime.push({ key: "mode", label: "Mode", value: p.mode, category: "runtime" });
  if (p.model) runtime.push({ key: "model", label: "Model", value: p.model, category: "runtime" });
  if (p.provider) runtime.push({ key: "provider", label: "Provider", value: p.provider, category: "runtime" });
  if (p.maxTokens) runtime.push({ key: "maxTok", label: "Max Tokens", value: p.maxTokens.toLocaleString(), category: "runtime" });

  const workspace: ToolbarMeta[] = [];
  if (p.cwd) workspace.push({ key: "cwd", label: "CWD", value: p.cwd, category: "workspace" });

  const all = [...builtins, ...(p.meta ?? [])];
  const grouped = new Map<string, ToolbarMeta[]>();
  for (const m of all) {
    const cat = CAT_LABEL[m.category ?? ""] ?? m.category ?? "Other";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(m);
  }

  return (
    <div className="toolbar-details">
      {p.agentInfo && <AgentSection info={p.agentInfo} />}

      <section className="toolbar-details-section">
        <h3 className="toolbar-details-section-title">Session</h3>
        <div className="toolbar-details-grid">
          {[...grouped.entries()]
            .filter(([c]) => c === "Session")
            .flatMap(([, items]) => items)
            .map((m) => (
              <Row key={m.key} label={m.label} value={m.value} />
            ))}
          {p.sessionId && <SessionIdRow sessionId={p.sessionId} onFork={p.onForkSession} />}
        </div>
      </section>

      {runtime.length > 0 && (
        <section className="toolbar-details-section">
          <h3 className="toolbar-details-section-title">Runtime</h3>
          <div className="toolbar-details-grid">
            {runtime.map((m) => (
              <Row key={m.key} label={m.label} value={m.value} />
            ))}
          </div>
        </section>
      )}

      <MetricsSection
        tokenUsage={p.tokenUsage}
        totalTokens={p.totalTokens}
        sessionStartMs={p.sessionStartMs}
        messageCount={p.messageCount}
        model={p.model}
      />

      {workspace.length > 0 && (
        <section className="toolbar-details-section">
          <h3 className="toolbar-details-section-title">Workspace</h3>
          <div className="toolbar-details-grid">
            {workspace.map((m) => (
              <Row key={m.key} label={m.label} value={m.value} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Row (re-exported from DetailSections for convenience) ──────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="toolbar-detail-item">
      <span className="toolbar-detail-label">{label}</span>
      <span className="toolbar-detail-value" title={value}>
        {value}
      </span>
    </div>
  );
}

// ── BottomToolbar props ────────────────────────────────────────────────────

export interface BottomToolbarProps {
  model?: string;
  mode?: string;
  tokenUsage: { inputTokens: number; outputTokens: number };
  contextWindowMax?: number;
  messageCount: number;
  isTurnActive: boolean;
  sessionStatus?: SessionTabStatus;
  agentInfo?: AgentInfo;
  sessionId?: string;
  sessionStartMs?: number;
  provider?: string;
  maxTokens?: number;
  meta?: ToolbarMeta[];
  onForkSession?: () => void;
  statusline?: StatuslineInfo;
  cwd?: string;
}

// ── BottomToolbar ──────────────────────────────────────────────────────────

export function BottomToolbar(props: BottomToolbarProps): React.ReactElement {
  const {
    model,
    mode,
    tokenUsage,
    contextWindowMax,
    messageCount,
    isTurnActive,
    sessionStatus,
    agentInfo,
    sessionId,
    sessionStartMs,
    provider,
    maxTokens,
    meta,
    onForkSession,
    statusline,
    cwd,
  } = props;

  const total = tokenUsage.inputTokens + tokenUsage.outputTokens;
  const [open, setOpen] = React.useState(false);
  const ratio = contextWindowMax && total > 0 ? Math.min(total / contextWindowMax, 1) : 0;

  // Build chips
  const chips: ToolbarMeta[] = [];

  if (mode && isTurnActive) {
    chips.push({ key: "mode", label: "Mode", value: mode, category: "runtime", modeIcon: mode });
  }
  if (model && isTurnActive) {
    chips.push({ key: "model", label: "Model", value: model, category: "runtime" });
  }
  if (messageCount > 0) {
    chips.push({ key: "msgs", label: "Messages", value: `msg:${messageCount}`, category: "metrics" });
  }

  chips.push({
    key: "tokens",
    label: "Tokens",
    value: `↑${fmt(tokenUsage.inputTokens)} ↓${fmt(tokenUsage.outputTokens)}`,
    category: "metrics",
  });

  if (contextWindowMax && total > 0) {
    const pct = Math.round(ratio * 100);
    const contextChip: ToolbarMeta = {
      key: "context",
      label: "Context",
      value: `${visualBar(ratio)} ${pct}%`,
      category: "metrics",
      contextColor: contextColor(ratio),
    };
    const tokenIdx = chips.findIndex((c) => c.key === "tokens");
    if (tokenIdx >= 0) {
      chips.splice(tokenIdx, 0, contextChip);
    } else {
      chips.push(contextChip);
    }
  }

  if (sessionStartMs) {
    chips.push({
      key: "dur",
      label: "Duration",
      value: fmtDuration(Date.now() - sessionStartMs),
      category: "metrics",
    });
  }

  if (meta) chips.push(...meta);

  // Statusline
  const prefix = statusline ? statuslinePrefix(statusline) : null;
  const slChips = statusline ? statuslineChips(statusline) : [];
  const statusChip: ToolbarMeta | null = sessionStatus
    ? { key: "sessionStatus", label: "Session Status", value: sessionStatus, category: "session", statusIndicator: sessionStatus }
    : null;

  return (
    <header className="toolbar">
      <div className="toolbar-main">
        <div className="toolbar-center">
          {prefix && <span className="toolbar-statusline-prefix">{prefix}</span>}
          <div className="toolbar-chips">
            {slChips.map((c) => (
              <Chip key={c.key} meta={c} />
            ))}
            {statusChip && <Chip meta={statusChip} />}
            {chips.map((c) => (
              <Chip key={c.key} meta={c} />
            ))}
          </div>
        </div>
        <div className="toolbar-right">
          <button
            className={`toolbar-toggle${open ? " open" : ""}`}
            onClick={() => setOpen((v) => !v)}
            title={open ? "Hide details" : "Show details"}
            aria-expanded={open}
            aria-label="Toggle details panel"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d={open ? "M3 9L7 5L11 9" : "M3 5L7 9L11 5"}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <DetailsPanel
          mode={mode}
          model={model}
          cwd={cwd}
          messageCount={messageCount}
          tokenUsage={tokenUsage}
          totalTokens={total}
          isTurnActive={isTurnActive}
          sessionStatus={sessionStatus}
          agentInfo={agentInfo}
          meta={meta}
          sessionId={sessionId}
          sessionStartMs={sessionStartMs}
          provider={provider}
          maxTokens={maxTokens}
          onForkSession={onForkSession}
        />
      )}
    </header>
  );
}
