import React from "react";
import type { AgentInfo, SessionTabStatus } from "../../store/sessionStore";
import type { ToolbarMeta, ContextColor } from "../primitives/Chip";
import { Chip } from "../primitives/Chip";
import {
  fmt,
  fmtDuration,
  visualBar,
  contextColor,
  StatuslineInfo,
  statuslinePrefix,
  statuslineChips,
  AgentSection,
  MetricsSection,
  SessionIdRow,
  TurnSection,
} from "./toolbar";

export type { ToolbarMeta, ContextColor };
export { fmt, visualBar, contextColor };
export type { StatuslineInfo };

export interface DetailsPanelProps {
  mode?: string;
  model?: string;
  cwd?: string;
  messageCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
  totalTokens: number;
  sessionStatus?: string;
  agentInfo?: AgentInfo;
  meta?: ToolbarMeta[];
  sessionId?: string;
  sessionStartMs?: number;
  provider?: string;
  maxTokens?: number;
  onForkSession?: () => void;
  lastTurnOutcome?: "completed" | "error" | "cancelled" | null;
  lastResponseAt?: string | null;
}

const CAT_LABEL: Record<string, string> = {
  session: "Session",
  runtime: "Runtime",
  metrics: "Metrics",
  workspace: "Workspace",
};

export function DetailsPanel(p: DetailsPanelProps): React.ReactElement {
  const builtins: ToolbarMeta[] = [];
  if (p.sessionStatus)
    builtins.push({
      key: "status",
      label: "Status",
      value: p.sessionStatus,
      category: "session",
    });
  if (p.sessionId)
    builtins.push({
      key: "sid",
      label: "Session",
      value: p.sessionId.slice(0, 8) + "...",
      category: "session",
    });
  if (p.sessionStatus === "running")
    builtins.push({
      key: "turn",
      label: "Turn",
      value: "Active",
      category: "session",
    });

  const runtime: ToolbarMeta[] = [];
  if (p.mode)
    runtime.push({
      key: "mode",
      label: "Mode",
      value: p.mode,
      category: "runtime",
    });
  if (p.model)
    runtime.push({
      key: "model",
      label: "Model",
      value: p.model,
      category: "runtime",
    });
  if (p.provider)
    runtime.push({
      key: "provider",
      label: "Provider",
      value: p.provider,
      category: "runtime",
    });
  if (p.maxTokens)
    runtime.push({
      key: "maxTok",
      label: "Max Tokens",
      value: p.maxTokens.toLocaleString(),
      category: "runtime",
    });

  const workspace: ToolbarMeta[] = [];
  if (p.cwd)
    workspace.push({
      key: "cwd",
      label: "CWD",
      value: p.cwd,
      category: "workspace",
    });

  const all = [...builtins, ...(p.meta ?? [])];
  const grouped = new Map<string, ToolbarMeta[]>();
  for (const m of all) {
    const cat = CAT_LABEL[m.category ?? ""] ?? m.category ?? "Other";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(m);
  }

  return (
    <div className="px-2.5 py-2 bg-bg-primary flex flex-col gap-[10px]">
      {p.agentInfo && <AgentSection info={p.agentInfo} />}

      <section className="mb-0">
        <h3 className="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.4px] mb-1">Session</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-[14px] gap-y-1">
          {[...grouped.entries()]
            .filter(([c]) => c === "Session")
            .flatMap(([, items]) => items)
            .map((m) => (
              <Row key={m.key} label={m.label} value={m.value} />
            ))}
          {p.sessionId && (
            <SessionIdRow sessionId={p.sessionId} onFork={p.onForkSession} />
          )}
        </div>
      </section>

      <TurnSection
        outcome={p.lastTurnOutcome ?? null}
        lastResponseAt={p.lastResponseAt ?? null}
        sessionStartMs={p.sessionStartMs}
      />

      {runtime.length > 0 && (
        <section className="mb-0">
          <h3 className="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.4px] mb-1">Runtime</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-[14px] gap-y-1">
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
        <section className="mb-0">
          <h3 className="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.4px] mb-1">Workspace</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-[14px] gap-y-1">
            {workspace.map((m) => (
              <Row key={m.key} label={m.label} value={m.value} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[1px] min-w-0">
      <span className="text-[10px] text-fg-muted uppercase tracking-[0.3px] whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
      <span className="text-xs text-fg-primary font-mono overflow-hidden text-ellipsis whitespace-nowrap" title={value}>
        {value}
      </span>
    </div>
  );
}

export interface SessionFooterProps {
  model?: string;
  mode?: string;
  tokenUsage: { inputTokens: number; outputTokens: number };
  contextWindowMax?: number;
  messageCount: number;
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
  lastTurnOutcome?: "completed" | "error" | "cancelled" | null;
  lastResponseAt?: string | null;
}

export const SessionFooter = React.memo(function SessionFooter(
  props: SessionFooterProps
): React.ReactElement {
  const {
    model,
    mode,
    tokenUsage,
    contextWindowMax,
    messageCount,
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
    lastTurnOutcome,
    lastResponseAt,
  } = props;

  const total = tokenUsage.inputTokens + tokenUsage.outputTokens;
  const [open, setOpen] = React.useState(false);
  const ratio =
    contextWindowMax && total > 0 ? Math.min(total / contextWindowMax, 1) : 0;

  // Build chips
  const chips: ToolbarMeta[] = [];

  if (mode && sessionStatus === "running") {
    chips.push({
      key: "mode",
      label: "Mode",
      value: mode,
      category: "runtime",
      modeIcon: mode,
    });
  }
  if (model && sessionStatus === "running") {
    chips.push({
      key: "model",
      label: "Model",
      value: model,
      category: "runtime",
    });
  }
  if (messageCount > 0) {
    chips.push({
      key: "msgs",
      label: "Messages",
      value: `msg:${messageCount}`,
      category: "metrics",
    });
  }

  chips.push({
    key: "tokens",
    label: "Tokens",
    value: `↑${fmt(tokenUsage.inputTokens)} ↓${fmt(tokenUsage.outputTokens)}`,
    category: "metrics",
  });

  if (contextWindowMax && total > 0) {
    const pct = visualBar(ratio);
    const contextChip: ToolbarMeta = {
      key: "context",
      label: "Context",
      value: `${pct}%`,
      category: "metrics",
      contextColor: contextColor(ratio),
      barPct: Number(pct),
    };
    const tokenIdx = chips.findIndex((c) => c.key === "tokens");
    if (tokenIdx >= 0) {
      chips.splice(tokenIdx, 0, contextChip);
    } else {
      chips.push(contextChip);
    }
  }

  // Static duration: compute once from sessionStartMs and lastResponseAt
  // (or sessionStartMs to now if still running). No live tick.
  if (sessionStartMs) {
    const endMs = lastResponseAt ? new Date(lastResponseAt).getTime() : Date.now();
    const staticElapsed = Math.max(0, endMs - sessionStartMs);
    chips.push({
      key: "dur",
      label: "Duration",
      value: fmtDuration(staticElapsed),
      category: "metrics",
    });
  }

  if (meta) chips.push(...meta);

  // Statusline
  const prefix = statusline ? statuslinePrefix(statusline) : null;
  const slChips = statusline ? statuslineChips(statusline, cwd) : [];
  const statusChip: ToolbarMeta | null = sessionStatus
    ? {
        key: "sessionStatus",
        label: "Session Status",
        value: sessionStatus,
        category: "session",
        statusIndicator: sessionStatus,
      }
    : null;

  // Turn outcome chip
  const turnChip: ToolbarMeta | null = (() => {
    if (sessionStatus === "running") {
      return {
        key: "turn",
        label: "Turn",
        value: "Active",
        category: "session" as const,
        turnStatus: "running" as const,
      };
    }
    if (lastTurnOutcome === "completed") {
      return {
        key: "turn",
        label: "Turn",
        value: "Done",
        category: "session" as const,
        turnStatus: "completed" as const,
      };
    }
    if (lastTurnOutcome === "error") {
      return {
        key: "turn",
        label: "Turn",
        value: "Error",
        category: "session" as const,
        turnStatus: "error" as const,
      };
    }
    if (lastTurnOutcome === "cancelled") {
      return {
        key: "turn",
        label: "Turn",
        value: "Cancelled",
        category: "session" as const,
        turnStatus: "cancelled" as const,
      };
    }
    return null;
  })();

  return (
    <header className="flex flex-col bg-bg-secondary shrink-0 border-t border-border">
      <div className="flex items-center justify-between px-3.5 py-1 gap-[10px] min-h-[28px]">
        <div className="flex items-center gap-2 flex-1 justify-start min-w-0 overflow-hidden">
          {prefix && (
            <span className="text-[11px] font-mono text-fg-muted whitespace-nowrap overflow-hidden text-ellipsis shrink-1 min-w-0 pr-[6px]">{prefix}</span>
          )}
          <div className="flex items-center gap-1 flex-nowrap overflow-hidden">
            {slChips.map((c) => (
              <Chip key={c.key} meta={c} />
            ))}
            {statusChip && <Chip meta={statusChip} />}
            {turnChip && <Chip meta={turnChip} />}
            {chips.map((c) => (
              <Chip key={c.key} meta={c} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-[6px] shrink-0">
          <button
            className={`flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-fg-secondary cursor-pointer shrink-0 transition-all duration-150 hover:bg-accent-hover hover:text-fg-primary${open ? " rotate-180" : ""}`}
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

      <div className={`overflow-hidden transition-all duration-150 ${open ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="overflow-hidden min-h-0">
          <DetailsPanel
            mode={mode}
            model={model}
            cwd={cwd}
            messageCount={messageCount}
            tokenUsage={tokenUsage}
            totalTokens={total}
            sessionStatus={sessionStatus}
            agentInfo={agentInfo}
            meta={meta}
            sessionId={sessionId}
            sessionStartMs={sessionStartMs}
            provider={provider}
            maxTokens={maxTokens}
            onForkSession={onForkSession}
            lastTurnOutcome={lastTurnOutcome}
            lastResponseAt={lastResponseAt}
          />
        </div>
      </div>
    </header>
  );
});
