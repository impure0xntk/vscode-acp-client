import React from "react";
import type { AgentInfo } from "../../hooks/useSessionContext";
import { Icon } from "../../lib/icons";
import { fmtCaps, fmtDuration } from "./formatting";

// ── Row ─────────────────────────────────────────────────────────────────────

export function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="toolbar-detail-item">
      <span className="toolbar-detail-label">{label}</span>
      <span className="toolbar-detail-value" title={value}>
        {value}
      </span>
    </div>
  );
}

// ── AgentSection ────────────────────────────────────────────────────────────

export function AgentSection({ info }: { info: AgentInfo }): React.ReactElement {
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
    <section className="toolbar-details-section">
      <h3 className="toolbar-details-section-title">Agent</h3>
      <div className="toolbar-details-grid">
        <Row label="Name" value={info.title ?? info.name} />
        {info.version && <Row label="Version" value={info.version} />}
        <Row label="Protocol" value={`v${info.protocolVersion}`} />
        {caps.length > 0 && <Row label="Caps" value={fmtCaps(caps)} />}
      </div>
    </section>
  );
}

// ── MetricsSection ──────────────────────────────────────────────────────────

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
  const duration = sessionStartMs
    ? fmtDuration(Date.now() - sessionStartMs)
    : "—";

  return (
    <section className="toolbar-details-section">
      <h3 className="toolbar-details-section-title">Metrics</h3>
      <div className="toolbar-details-grid">
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

// ── SessionIdRow ────────────────────────────────────────────────────────────

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
    <div className="toolbar-detail-item toolbar-detail-item--full">
      <span className="toolbar-detail-label">Session ID</span>
      <div className="toolbar-session-id-row">
        <span className="toolbar-detail-value" title={sessionId}>
          {shortId}
        </span>
        <button
          className="toolbar-session-action"
          onClick={handleCopy}
          title="Copy session ID"
        >
          {copied ? <Icon name="check" /> : <Icon name="copy" />}
        </button>
        {onFork && (
          <button
            className="toolbar-session-action"
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
