import React from "react";
import type { AgentInfo, SessionTabStatus } from "../hooks/useSessionContext";

export type ContextColor = "normal" | "warning" | "critical";

export interface ToolbarMeta {
  key: string;
  label: string;
  value: string;
  icon?: React.ReactElement;
  category?: "session" | "runtime" | "metrics" | "workspace";
  statusIndicator?: SessionTabStatus;
  modeIcon?: string;
  contextColor?: ContextColor;
}

// ── status / mode maps ────────────────────────────────────────────────────

const STATUS_DOT: Record<SessionTabStatus, { color: string; glyph: string }> = {
  running:   { color: "#4ec9b0", glyph: "●" },
  idle:      { color: "#cca700", glyph: "●" },
  completed: { color: "#4ec9b0", glyph: "✓" },
  error:     { color: "#f14c4c", glyph: "●" },
  cancelled: { color: "#666666", glyph: "●" },
};

const MODE_GLYPH: Record<string, string> = {
  tool:    "🔧",
  final:   "✅",
  clarify: "❓",
  plan:    "📋",
};

// ── Statusline info ───────────────────────────────────────────────────────

export interface StatuslineInfo {
  hostname?: string;
  repoName?: string;
  branch?: string;
  tag?: string;
}

// ── BottomToolbar props ───────────────────────────────────────────────────

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
}

// ── DetailsPanel props ──────────────────────────────────────────────────

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

// ── helpers ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtCaps(caps: string[]): string {
  if (caps.length <= 3) return caps.join(", ");
  return `${caps.slice(0, 3).join(", ")}, +${caps.length - 3} more`;
}

/** Build a visual bar string: ████░░░ (10 chars) */
function visualBar(ratio: number): string {
  const filled = Math.round(ratio * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

/** Context usage color thresholds */
function contextColor(ratio: number): string {
  if (ratio >= 0.85) return "critical";
  if (ratio >= 0.70) return "warning";
  return "normal";
}

const CAT_LABEL: Record<string, string> = {
  session: "Session",
  runtime: "Runtime",
  metrics: "Metrics",
  workspace: "Workspace",
};

const STATUS_COLOR: Record<string, string> = {
  running: "#4ec9b0",
  idle: "#cca700",
  completed: "#4ec9b0",
  error: "#f14c4c",
  cancelled: "#666666",
};

// ── StatuslineRow ─────────────────────────────────────────────────────────

function StatuslineRow({
  statusline,
  sessionStatus,
}: {
  statusline?: StatuslineInfo;
  sessionStatus?: SessionTabStatus;
}): React.ReactElement | null {
  if (!statusline) return null;
  const { hostname, repoName, branch, tag } = statusline;

  return (
    <div className="toolbar-statusline">
      {hostname && (
        <span className="toolbar-statusline-seg">{hostname}</span>
      )}
      {repoName && (
        <>
          <span className="toolbar-statusline-sep">│</span>
          <span className="toolbar-statusline-seg">{repoName}</span>
        </>
      )}
      {branch && (
        <>
          <span className="toolbar-statusline-sep">│</span>
          <span className="toolbar-statusline-seg toolbar-statusline-branch">{branch}</span>
        </>
      )}
      {tag && (
        <>
          <span className="toolbar-statusline-sep">│</span>
          <span className="toolbar-statusline-seg toolbar-statusline-tag">{tag}</span>
        </>
      )}
      {sessionStatus && (
        <>
          <span className="toolbar-statusline-sep">│</span>
          <span className="toolbar-statusline-seg">
            <span
              className="toolbar-statusline-dot"
              style={{ color: STATUS_COLOR[sessionStatus] ?? "#808080" }}
              aria-hidden="true"
            >
              {sessionStatus === "running" ? "●" : sessionStatus === "completed" ? "✓" : "●"}
            </span>
            {sessionStatus}
          </span>
        </>
      )}
    </div>
  );
}

// ── Chip ──────────────────────────────────────────────────────────────────

function Chip({
  meta,
  onClick,
}: {
  meta: ToolbarMeta;
  onClick?: () => void;
}): React.ReactElement {
  const cat = meta.category ?? "";
  const dot = meta.statusIndicator ? STATUS_DOT[meta.statusIndicator] : null;
  const icon = meta.modeIcon ? MODE_GLYPH[meta.modeIcon] : null;
  const ctxColor = meta.contextColor ? ` toolbar-chip--ctx-${meta.contextColor}` : "";

  return (
    <span
      className={`toolbar-chip toolbar-chip--${cat}${ctxColor}${onClick ? " toolbar-chip--clickable" : ""}`}
      title={`${meta.label}: ${meta.value}`}
      aria-label={`${meta.label}: ${meta.value}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {dot && (
        <span className="toolbar-chip-dot" style={{ color: dot.color }} aria-hidden="true">
          {dot.glyph}
        </span>
      )}
      {icon && <span className="toolbar-chip-icon" aria-hidden="true">{icon}</span>}
      {meta.icon && <span className="toolbar-chip-icon">{meta.icon}</span>}
      <span className="toolbar-chip-value">{meta.value}</span>
    </span>
  );
}

// ── DetailsPanel ──────────────────────────────────────────────────────────

function AgentSection({ info }: { info: AgentInfo }): React.ReactElement {
  const caps: string[] = [];
  if (info.capabilities?.loadSession) caps.push("load session");
  if (info.capabilities?.sessionCapabilities?.fork) caps.push("fork");
  if (info.capabilities?.sessionCapabilities?.list) caps.push("list");
  if (info.capabilities?.sessionCapabilities?.resume) caps.push("resume");
  if (info.capabilities?.sessionCapabilities?.delete) caps.push("delete");
  if (info.capabilities?.sessionCapabilities?.close) caps.push("close");
  if (info.capabilities?.sessionCapabilities?.additionalDirectories) caps.push("addl dirs");
  if (info.capabilities?.promptCapabilities?.image) caps.push("image");
  if (info.capabilities?.promptCapabilities?.audio) caps.push("audio");
  if (info.capabilities?.promptCapabilities?.embeddedContext) caps.push("embedded ctx");

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

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="toolbar-detail-item">
      <span className="toolbar-detail-label">{label}</span>
      <span className="toolbar-detail-value" title={value}>{value}</span>
    </div>
  );
}

function MetricsSection({
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
  const duration = sessionStartMs ? fmtDuration(Date.now() - sessionStartMs) : "—";

  return (
    <section className="toolbar-details-section">
      <h3 className="toolbar-details-section-title">Metrics</h3>
      <div className="toolbar-details-grid">
        <Row label="Input" value={`${tokenUsage.inputTokens.toLocaleString()} tokens`} />
        <Row label="Output" value={`${tokenUsage.outputTokens.toLocaleString()} tokens`} />
        <Row label="Total" value={`${totalTokens.toLocaleString()} tokens`} />
        <Row label="Messages" value={String(messageCount)} />
        <Row label="Duration" value={`▸ ${duration}`} />
        {model && <Row label="Est. Cost" value={`— (${model})`} />}
      </div>
    </section>
  );
}

function SessionIdRow({
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

  const shortId = sessionId.length > 12 ? `${sessionId.slice(0, 12)}...` : sessionId;

  return (
    <div className="toolbar-detail-item toolbar-detail-item--full">
      <span className="toolbar-detail-label">Session ID</span>
      <div className="toolbar-session-id-row">
        <span className="toolbar-detail-value" title={sessionId}>{shortId}</span>
        <button className="toolbar-session-action" onClick={handleCopy} title="Copy session ID">
          {copied ? "✓" : "📋"}
        </button>
        {onFork && (
          <button className="toolbar-session-action" onClick={onFork} title="Fork session">
            🍴
          </button>
        )}
      </div>
    </div>
  );
}

export function DetailsPanel(p: DetailsPanelProps): React.ReactElement {
  const builtins: ToolbarMeta[] = [];
  if (p.sessionStatus) builtins.push({ key: "status", label: "Status", value: p.sessionStatus, category: "session" });
  if (p.sessionId) builtins.push({ key: "sid", label: "Session", value: p.sessionId.slice(0, 8) + "...", category: "session" });
  if (p.isTurnActive) builtins.push({ key: "turn", label: "Turn", value: "⚡ Active", category: "session" });

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
            .map((m) => <Row key={m.key} label={m.label} value={m.value} />)}
          {p.sessionId && <SessionIdRow sessionId={p.sessionId} onFork={p.onForkSession} />}
        </div>
      </section>

      {runtime.length > 0 && (
        <section className="toolbar-details-section">
          <h3 className="toolbar-details-section-title">Runtime</h3>
          <div className="toolbar-details-grid">{runtime.map((m) => <Row key={m.key} label={m.label} value={m.value} />)}</div>
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
          <div className="toolbar-details-grid">{workspace.map((m) => <Row key={m.key} label={m.label} value={m.value} />)}</div>
        </section>
      )}
    </div>
  );
}

// ── BottomToolbar ─────────────────────────────────────────────────────────

export function BottomToolbar(props: BottomToolbarProps): React.ReactElement {
  const {
    model, mode,
    tokenUsage, contextWindowMax,
    messageCount, isTurnActive,
    sessionStatus, agentInfo,
    sessionId, sessionStartMs,
    provider, maxTokens, meta,
    onForkSession,
    statusline,
  } = props;

  const total = tokenUsage.inputTokens + tokenUsage.outputTokens;
  const [open, setOpen] = React.useState(false);

  const ratio = contextWindowMax && total > 0 ? Math.min(total / contextWindowMax, 1) : 0;

  // ── chips (priority order per UI-DESIGN.md §4.2) ──────────────────────
  const chips: ToolbarMeta[] = [];

  // P2: mode + model (only when turn active)
  if (mode && isTurnActive) {
    chips.push({ key: "mode", label: "Mode", value: mode, category: "runtime", modeIcon: mode });
  }
  if (model && isTurnActive) {
    chips.push({ key: "model", label: "Model", value: model, category: "runtime" });
  }

  // P3: messages (tooltip shows total tokens)
  if (messageCount > 0) {
    chips.push({
      key: "msgs",
      label: "Messages",
      value: `msg:${messageCount}`,
      category: "metrics",
    });
  }

  // P3: Tokens chip — always shown (shows ↑0 ↓0 when no usage yet)
  {
    const tokenChip: ToolbarMeta = {
      key: "tokens",
      label: "Tokens",
      value: `↑${fmt(tokenUsage.inputTokens)} ↓${fmt(tokenUsage.outputTokens)}`,
      category: "metrics",
    };
    chips.push(tokenChip);
  }

  // P3: Context chip with visual bar
  if (contextWindowMax && total > 0) {
    const pct = Math.round(ratio * 100);
    const colorClass = contextColor(ratio);
    const contextChip: ToolbarMeta = {
      key: "context",
      label: "Context",
      value: `${visualBar(ratio)} ${pct}%`,
      category: "metrics",
      contextColor: colorClass,
    };
    const tokenIdx = chips.findIndex(c => c.key === "tokens");
    if (tokenIdx >= 0) {
      chips.splice(tokenIdx, 0, contextChip);
    } else {
      chips.push(contextChip);
    }
  }

  // P3: Duration chip (if session start available)
  if (sessionStartMs) {
    const durChip: ToolbarMeta = {
      key: "dur",
      label: "Duration",
      value: fmtDuration(Date.now() - sessionStartMs),
      category: "metrics",
    };
    chips.push(durChip);
  }

  if (meta) chips.push(...meta);

  const toggleDetails = () => setOpen((v) => !v);

  return (
    <header className="toolbar">
      {/* Row 0: statusline (Claude Code style) */}
      <StatuslineRow
        statusline={statusline}
        sessionStatus={sessionStatus}
      />

      {/* Row 1: chips | ▼ */}
      <div className="toolbar-main">
        <div className="toolbar-center">
          <div className="toolbar-chips">
            {chips.map((c) => (
              <Chip key={c.key} meta={c} />
            ))}
          </div>
        </div>
        <div className="toolbar-right">
          <button
            className={`toolbar-toggle${open ? " open" : ""}`}
            onClick={toggleDetails}
            title={open ? "Hide details" : "Show details"}
            aria-expanded={open}
            aria-label="Toggle details panel"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d={open ? "M3 9L7 5L11 9" : "M3 5L7 9L11 5"}
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Row 2: details panel */}
      {open && (
        <DetailsPanel
          mode={mode} model={model}
          messageCount={messageCount}
          tokenUsage={tokenUsage} totalTokens={total}
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
