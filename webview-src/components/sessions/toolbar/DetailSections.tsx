import React from "react";
import type { AgentInfo, SessionInfoDTO } from "../../../store/sessionStore";
import { Icon } from "../../../lib/icons";
import { fmtCaps, fmtDuration, fmtTimestamp } from "./formatting";

export function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-2 py-px">
      <span className="text-[10px] text-fg-muted shrink-0">{label}</span>
      <span className="text-[11px] text-fg-primary text-right truncate font-[var(--font-mono)]" title={value}>
        {value}
      </span>
    </div>
  );
}

export function AgentSection({
  info,
}: {
  info: AgentInfo;
}): React.ReactElement {
  const caps: string[] = [];
  if (info.capabilities?.loadSession) caps.push("load session");
  if (info.capabilities?.sessionCapabilities?.fork) caps.push("fork");
  if (info.capabilities?.sessionCapabilities?.list) caps.push("list");
  if (info.capabilities?.sessionCapabilities?.resume) caps.push("resume");
  if (info.capabilities?.sessionCapabilities?.delete) caps.push("delete");
  if (info.capabilities?.sessionCapabilities?.close) caps.push("close");
  if (info.capabilities?.sessionCapabilities?.additionalDirectories)
    caps.push("addl dirs");
  if (info.capabilities?.promptCapabilities?.image) caps.push("image");
  if (info.capabilities?.promptCapabilities?.audio) caps.push("audio");
  if (info.capabilities?.promptCapabilities?.embeddedContext)
    caps.push("embedded ctx");

  return (
    <section className="mb-3">
      <h3 className="text-[10px] font-semibold text-fg-muted mb-1">Agent</h3>
      <div className="flex flex-col gap-0.5">
        <Row label="Name" value={info.title ?? info.name} />
        {info.version && <Row label="Version" value={info.version} />}
        <Row label="Protocol" value={`v${info.protocolVersion}`} />
        {caps.length > 0 && <Row label="Caps" value={fmtCaps(caps)} />}
      </div>
    </section>
  );
}

export function MetricsSection({
  tokenUsage,
  totalTokens,
  sessionStartMs,
  messageCount,
  model,
}: {
  tokenUsage: { inputTokens: number; outputTokens: number };
  totalTokens: number;
  sessionStartMs?: number;
  messageCount: number;
  model?: string;
}): React.ReactElement {
  // Static duration: sessionStartMs → lastResponseAt (or now if running).
  // No live tick — updates only when props change.
  const duration = sessionStartMs
    ? fmtDuration(Math.max(0, Date.now() - sessionStartMs))
    : "—";

  return (
    <section className="mb-0">
      <h3 className="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.4px] mb-1">Metrics</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-3.5 gap-y-1">
        <Row
          label="Input"
          value={`${tokenUsage.inputTokens.toLocaleString()} tokens`}
        />
        <Row
          label="Output"
          value={`${tokenUsage.outputTokens.toLocaleString()} tokens`}
        />
        <Row label="Total" value={`${totalTokens.toLocaleString()} tokens`} />
        <Row label="Messages" value={String(messageCount)} />
        <Row label="Duration" value={`▸ ${duration}`} />
        {model && <Row label="Est. Cost" value={`— (${model})`} />}
      </div>
    </section>
  );
}

export function TurnSection({
  outcome,
  lastResponseAt,
  sessionStartMs,
}: {
  outcome: "completed" | "error" | "cancelled" | null;
  lastResponseAt: string | null;
  sessionStartMs?: number;
}): React.ReactElement | null {
  if (!outcome && !lastResponseAt) return null;

  const outcomeLabel =
    outcome === "completed"
      ? "Completed"
      : outcome === "error"
        ? "Error"
        : outcome === "cancelled"
          ? "Cancelled"
          : lastResponseAt
            ? "Active"
            : "—";

  const outcomeIcon =
    outcome === "completed"
      ? "check"
      : outcome === "error"
        ? "cross"
        : outcome === "cancelled"
          ? "ban"
          : "circle-outline";

  // Turn duration: sessionStartMs → lastResponseAt.
  const turnDuration =
    lastResponseAt && sessionStartMs
      ? fmtDuration(Math.max(0, new Date(lastResponseAt).getTime() - sessionStartMs))
      : null;

  return (
    <section className="mb-0">
      <h3 className="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.4px] mb-1">Turn</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-3.5 gap-y-1">
        <div className="flex flex-col gap-px min-w-0">
          <span className="text-[10px] text-fg-muted uppercase">Outcome</span>
          <span className={`text-xs text-fg-primary font-[var(--font-mono)] overflow-hidden text-ellipsis whitespace-nowrap ${
            outcome === "completed" ? "!text-[var(--success)]" :
            outcome === "error" ? "!text-error" :
            outcome === "cancelled" ? "!text-fg-muted opacity-70" :
            "!text-[#4fc3f7]"
          }`}>
            <Icon name={outcomeIcon} size="sm" className="inline-flex items-center mr-1 shrink-0" />
            {outcomeLabel}
          </span>
        </div>
        <Row label="Last Response" value={fmtTimestamp(lastResponseAt)} />
        {turnDuration && <Row label="Turn Duration" value={turnDuration} />}
      </div>
    </section>
  );
}

// Compact variant for Unified section header expansion.
export function SectionDetailsPanel({
  info,
  messageCount,
  onForkSession,
  agentInfo,
}: {
  info: SessionInfoDTO;
  messageCount: number;
  onForkSession?: () => void;
  agentInfo?: AgentInfo;
}): React.ReactElement {
  const total = info.tokenUsage.inputTokens + info.tokenUsage.outputTokens;
  const sessionStartMs = info.createdAt
    ? new Date(info.createdAt).getTime()
    : undefined;

  // Static duration from createdAt to lastResponseAt (or now).
  const detailElapsed = sessionStartMs
    ? (() => {
        const end = info.lastResponseAt ? new Date(info.lastResponseAt).getTime() : Date.now();
        return fmtDuration(Math.max(0, end - sessionStartMs));
      })()
    : "—";

  return (
    <div className="px-2.5 py-2 bg-bg-primary flex flex-col gap-2 animate-toolbar-details-in">
      {agentInfo && <AgentSection info={agentInfo} />}

      <section className="mb-0">
        <h3 className="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.4px] mb-1">Metrics</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-3.5 gap-y-1">
          <Row
            label="Input"
            value={`${info.tokenUsage.inputTokens.toLocaleString()} tokens`}
          />
          <Row
            label="Output"
            value={`${info.tokenUsage.outputTokens.toLocaleString()} tokens`}
          />
          <Row label="Total" value={`${total.toLocaleString()} tokens`} />
          <Row label="Messages" value={String(messageCount)} />
          {sessionStartMs && (
            <Row label="Duration" value={`▸ ${detailElapsed}`} />
          )}
          {info.model && <Row label="Model" value={info.model} />}
        </div>
      </section>

      {info.cwd && (
        <section className="mb-0">
          <h3 className="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.4px] mb-1">Workspace</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-3.5 gap-y-1">
            <Row label="CWD" value={info.cwd} />
          </div>
        </section>
      )}

      <TurnSection
        outcome={info.lastTurnOutcome}
        lastResponseAt={info.lastResponseAt}
        sessionStartMs={sessionStartMs}
      />

      <section className="mb-0">
        <h3 className="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.4px] mb-1">Session</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-3.5 gap-y-1">
          <SessionIdRow sessionId={info.sessionId} onFork={onForkSession} />
        </div>
      </section>
    </div>
  );
}

export function SessionIdRow({
  sessionId,
  onFork,
}: {
  sessionId: string;
  onFork?: () => void;
}): React.ReactElement {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = sessionId;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const shortId =
    sessionId.length > 12 ? `${sessionId.slice(0, 12)}...` : sessionId;

  return (
    <div className="flex flex-col gap-px min-w-0 col-span-full">
      <span className="text-[10px] text-fg-muted uppercase">Session ID</span>
      <div className="flex items-center gap-1">
        <span className="text-xs text-fg-primary font-[var(--font-mono)] overflow-hidden text-ellipsis whitespace-nowrap" title={sessionId}>
          {shortId}
        </span>
        <button
          className="inline-flex items-center justify-center w-5 h-5 p-0 border-0 rounded-[3px] bg-transparent text-fg-secondary hover:bg-accent-hover hover:text-fg-primary cursor-pointer"
          onClick={handleCopy}
          title="Copy session ID"
        >
          {copied ? <Icon name="check" /> : <Icon name="copy" />}
        </button>
        {onFork && (
          <button
            className="inline-flex items-center justify-center w-5 h-5 p-0 border-0 rounded-[3px] bg-transparent text-fg-secondary hover:bg-accent-hover hover:text-fg-primary cursor-pointer"
            onClick={onFork}
            title="Fork session"
          >
            <Icon name="repo-forked" />
          </button>
        )}
      </div>
    </div>
  );
}
