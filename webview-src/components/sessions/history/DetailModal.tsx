import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Icon } from "../../../lib/icons";

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

interface Turn {
  index: number;
  startAt: number;
  endAt: number;
  messages: ChatMessage[];
  completed: boolean;
}

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

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function contextUsagePct(usage: number, max: number | null): number {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.round((usage / max) * 100));
}

function contextBarColor(pct: number): string {
  if (pct >= 90) return "var(--error)";
  if (pct >= 70) return "var(--warning)";
  return "var(--success)";
}

/** Group flat messages into Turns. A new Turn starts at each user message. */
function groupTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: ChatMessage[] = [];
  let turnIndex = 0;

  for (const msg of messages) {
    if (msg.role === "user" && current.length > 0) {
      const last = current[current.length - 1];
      turns.push({
        index: turnIndex++,
        startAt: current[0].timestamp,
        endAt: last.timestamp,
        messages: current,
        completed: last.role === "agent" || last.role === "assistant",
      });
      current = [];
    }
    current.push(msg);
  }

  if (current.length > 0) {
    const last = current[current.length - 1];
    turns.push({
      index: turnIndex,
      startAt: current[0].timestamp,
      endAt: last.timestamp,
      messages: current,
      completed: last.role === "agent" || last.role === "assistant",
    });
  }

  return turns;
}

interface RoleConfig {
  icon: string;
  label: string;
  bgClass: string;
}

function roleConfig(role: string): RoleConfig {
  switch (role) {
    case "user":
      return {
        icon: "person",
        label: "user",
        bgClass:
          "bg-[color-mix(in_srgb,var(--user-bubble)_8%,transparent)] border-l-[var(--user-bubble)]",
      };
    case "tool":
      return {
        icon: "tools",
        label: "tool",
        bgClass:
          "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] border-l-[var(--accent)]",
      };
    case "assistant":
    case "agent":
      return {
        icon: "sparkle",
        label: "agent",
        bgClass: "bg-transparent border-l-transparent",
      };
    default:
      return {
        icon: "question",
        label: role || "unknown",
        bgClass: "bg-transparent border-l-transparent",
      };
  }
}

interface OutcomeConfig {
  icon: string;
  colorClass: string;
}

function turnOutcome(turn: Turn): OutcomeConfig {
  if (!turn.completed)
    return { icon: "circle-outline", colorClass: "text-fg-muted" };
  return { icon: "check", colorClass: "text-[var(--success)]" };
}

function turnDuration(turn: Turn): string | null {
  const ms = turn.endAt - turn.startAt;
  if (ms <= 0) return null;
  return formatDuration(ms);
}

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
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());
  const msgListRef = useRef<HTMLDivElement>(null);

  const toggleMsg = useCallback((id: string) => {
    setExpandedMsgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleTurn = useCallback((idx: number) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const turns = useMemo(() => groupTurns(messages), [messages]);

  useEffect(() => {
    const initial = new Set(messages.slice(0, 3).map((m) => m.id));
    setExpandedMsgs(initial);
  }, [messages]);

  useEffect(() => {
    setExpandedTurns(new Set(turns.map((t) => t.index)));
  }, [turns]);

  const pct = contextUsagePct(
    session.tokenUsage.total,
    session.contextWindowMax
  );

  const sessionStatus =
    session.status === "completed"
      ? { icon: "check", color: "text-[var(--success)]" as const, label: "completed" }
      : session.status === "error"
        ? { icon: "cross", color: "text-[var(--error)]" as const, label: "error" }
        : session.status === "cancelled"
          ? { icon: "ban", color: "text-fg-muted opacity-70" as const, label: "cancelled" }
          : session.status === "running"
            ? { icon: "circle-outline", color: "text-[#4fc3f7]" as const, label: "running" }
            : { icon: "circle-outline", color: "text-fg-muted" as const, label: session.status };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] animate-modal-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-border rounded-lg w-[90%] max-w-[760px] max-h-[85vh] flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-modal-slide-in"
        onClick={(e) => e.stopPropagation()}
      >

        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h4 className="m-0 text-[13px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
            {session.title}
          </h4>
          <button
            className="flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-fg-secondary text-base cursor-pointer transition-colors hover:bg-error hover:text-user-fg"
            onClick={onClose}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>


        <div className="px-4 py-2 border-b border-border shrink-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="inline-flex items-center gap-1 text-fg-secondary">
              <Icon name="sparkle" size="sm" /> {session.agentId}
            </span>
            {session.model && (
              <span className="text-fg-muted" title={`Model: ${session.model}`}>
                {session.model}
              </span>
            )}
            {session.mode && (
              <span className="text-fg-muted">{session.mode}</span>
            )}
            <span
              className="inline-flex items-center gap-1 text-fg-muted"
              title={session.cwd}
            >
              <Icon name="folder-opened" size="sm" /> {session.cwd}
            </span>
            <span
              className={`inline-flex items-center gap-1 font-[var(--font-mono)] ${sessionStatus.color}`}
              title={`Session status: ${sessionStatus.label}`}
            >
              <Icon name={sessionStatus.icon} size="sm" /> {sessionStatus.label}
            </span>
            <span className="text-fg-muted">
              {session.messageCount} messages · {turns.length} turns
            </span>
            <span className="inline-flex items-center gap-1 text-fg-muted font-[var(--font-mono)]">
              <Icon name="arrow-up" size="sm" />{" "}
              {formatTokens(session.tokenUsage.input)}{" "}
              <Icon name="arrow-down" size="sm" />{" "}
              {formatTokens(session.tokenUsage.output)}
            </span>
            {session.contextWindowMax != null && (
              <span className="inline-flex items-center gap-1 text-fg-muted font-[var(--font-mono)]">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: contextBarColor(pct) }}
                />
                {pct}% · {formatTokens(session.tokenUsage.total)}/
                {formatTokens(session.contextWindowMax)}
              </span>
            )}
          </div>
        </div>


        <div className="flex-1 overflow-y-auto px-4 py-2" ref={msgListRef}>
          {turns.length === 0 ? (
            <div className="py-6 text-center text-fg-muted text-[11px]">
              No messages in this session.
            </div>
          ) : (
            turns.map((turn) => {
              const turnExpanded = expandedTurns.has(turn.index);
              const oc = turnOutcome(turn);
              const dur = turnDuration(turn);
              return (
                <div key={turn.index} className="mb-2">
                  {/* Turn header */}
                  <div
                    className="flex items-center gap-1.5 px-1.5 py-1 rounded cursor-pointer select-none text-[10px] text-fg-muted hover:bg-accent-hover transition-colors"
                    onClick={() => toggleTurn(turn.index)}
                  >
                    <span>{turnExpanded ? "▾" : "▸"}</span>
                    <span className="font-semibold text-fg-secondary font-[var(--font-mono)]">
                      Turn {turn.index + 1}
                    </span>
                    <span
                      className={`inline-flex items-center gap-0.5 font-[var(--font-mono)] ${oc.colorClass}`}
                    >
                      <Icon name={oc.icon} size="sm" />
                    </span>
                    <span className="inline-flex items-center gap-0.5 font-[var(--font-mono)]">
                      <Icon name="play" size="sm" />{" "}
                      {formatTimestamp(turn.startAt)}
                    </span>
                    <span className="inline-flex items-center gap-0.5 font-[var(--font-mono)]">
                      <Icon name="stop" size="sm" />{" "}
                      {formatTimestamp(turn.endAt)}
                    </span>
                    {dur && (
                      <span className="inline-flex items-center gap-0.5 font-[var(--font-mono)]">
                        <Icon name="clock" size="sm" /> {dur}
                      </span>
                    )}
                  </div>

                  {/* Turn messages */}
                  {turnExpanded && (
                    <div className="ml-3 pl-2 border-l border-border">
                      {turn.messages.map((msg) => {
                        const isExpanded = expandedMsgs.has(msg.id);
                        const rc = roleConfig(msg.role);
                        return (
                          <div
                            key={msg.id}
                            className={`p-1.5 rounded mb-1 cursor-pointer transition-colors hover:bg-accent-hover border-l-2 ${rc.bgClass}`}
                            onClick={() => toggleMsg(msg.id)}
                          >
                            <div className="flex items-center gap-1.5 mb-[2px]">
                              <Icon
                                name={rc.icon}
                                size="sm"
                                className="text-fg-secondary shrink-0"
                              />
                              <span className="text-[10px] font-medium text-fg-secondary lowercase">
                                {rc.label}
                              </span>
                              <span className="text-[10px] text-fg-muted font-[var(--font-mono)]">
                                {new Date(msg.timestamp).toLocaleString()}
                              </span>
                              <span className="ml-auto text-[10px] text-fg-muted">
                                {isExpanded ? "▾" : "▸"}
                              </span>
                            </div>
                            {isExpanded && (
                              <div className="text-[11px] leading-relaxed text-fg-primary whitespace-pre-wrap break-words font-[var(--font-mono)]">
                                {msg.content}
                              </div>
                            )}
                            {!isExpanded && (
                              <div className="text-[11px] text-fg-muted overflow-hidden text-ellipsis whitespace-nowrap">
                                {msg.content.slice(0, 120)}
                                {msg.content.length > 120 ? "…" : ""}
                              </div>
                            )}
                            {msg.inlineFilePaths &&
                              msg.inlineFilePaths.length > 0 &&
                              isExpanded && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {msg.inlineFilePaths.map((fp) => (
                                    <span
                                      key={fp}
                                      className="text-[10px] text-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-1 py-[2px] rounded font-[var(--font-mono)]"
                                    >
                                      <Icon name="file" size="sm" /> {fp}
                                    </span>
                                  ))}
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>


        <div className="flex justify-end gap-1.5 px-4 py-2 border-t border-border shrink-0">
          <button
            className="px-2.5 py-[3px] border border-accent rounded bg-accent text-user-fg text-[11px] cursor-pointer whitespace-nowrap hover:bg-[color-mix(in_srgb,var(--accent)_80%,white)]"
            onClick={onRestore}
          >
            Restore Session
          </button>
          <button
            className="px-2.5 py-[3px] border border-border rounded bg-bg-input text-fg-primary text-[11px] cursor-pointer whitespace-nowrap hover:bg-accent-hover"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
