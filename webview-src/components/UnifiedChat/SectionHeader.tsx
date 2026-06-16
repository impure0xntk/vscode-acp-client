import React, { useCallback } from "react";
import { useLogger } from "../../hooks/useLogger";
import type { SessionInfoDTO } from "../../store/sessionStore";
import { IconPin, IconPinFilled } from "../../lib/icons";
import { Chip } from "../ui/Chip";
import type { ToolbarMeta } from "../ui/Chip";
import { fmt, visualBar, contextColor } from "../toolbar/formatting";

export interface SectionHeaderProps {
  sessionKey: string;
  agentId: string;
  title: string;
  status: "idle" | "running" | "completed" | "error" | "cancelled";
  color: string;
  messageCount: number;
  isActive: boolean;
  isPinned: boolean;
  /** Split direction controls which edge gets the color accent */
  splitDirection?: "vertical" | "horizontal";
  onClick: () => void;
  onTogglePin: () => void;
  onClose: () => void;
  /** Session info for token usage and elapsed time display */
  info?: SessionInfoDTO;
}

export const SectionHeader = React.memo(function SectionHeader({
  sessionKey,
  agentId,
  title,
  status,
  color,
  messageCount,
  isActive,
  isPinned,
  splitDirection = "vertical",
  onClick,
  onTogglePin,
  onClose,
  info,
}: SectionHeaderProps): React.ReactElement {
  const log = useLogger("SectionHeader");

  const handleClick = useCallback(() => {
    log.debug("header click", { sessionKey, agentId, isActive });
    onClick();
  }, [onClick, log, sessionKey, agentId, isActive]);

  const handleTogglePin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      log.debug("pin toggle", { sessionKey, isPinned: !isPinned });
      onTogglePin();
    },
    [onTogglePin, log, sessionKey, isPinned],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      log.info("close section", { sessionKey });
      onClose();
    },
    [onClose, log, sessionKey],
  );



  // Token usage percentage
  const tokenPercentage =
    info?.contextWindowMax && info.contextWindowMax > 0
      ? Math.round((info.tokenUsage.totalTokens / info.contextWindowMax) * 100)
      : null;

  // Accent edge: horizontal split (side-by-side) → top border on header,
  //              vertical split (stacked) → left border on header
  const isHorizontal = splitDirection === "horizontal";

  const activeBg = isActive ? `${color}20` : `${color}14`;

  // ── Build chips (mirrors BottomToolbar chip-building logic) ──────────
  const total = info
    ? info.tokenUsage.inputTokens + info.tokenUsage.outputTokens
    : 0;
  const ratio =
    info?.contextWindowMax && total > 0
      ? Math.min(total / info.contextWindowMax, 1)
      : 0;

  const chips: ToolbarMeta[] = [];

  if (info?.mode && info.status === "running") {
    chips.push({
      key: "mode",
      label: "Mode",
      value: info.mode,
      category: "runtime",
      modeIcon: info.mode,
    });
  }
  if (info?.model && info.status === "running") {
    chips.push({
      key: "model",
      label: "Model",
      value: info.model,
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
    value: `↑${fmt(info?.tokenUsage.inputTokens ?? 0)} ↓${fmt(info?.tokenUsage.outputTokens ?? 0)}`,
    category: "metrics",
  });

  if (info?.contextWindowMax && total > 0) {
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

  // Turn outcome chip
  const turnChip: ToolbarMeta | null = (() => {
    if (info?.status === "running") {
      return {
        key: "turn",
        label: "Turn",
        value: "Active",
        category: "session" as const,
        turnStatus: "running" as const,
      };
    }
    if (info?.lastTurnOutcome === "completed") {
      return {
        key: "turn",
        label: "Turn",
        value: "Done",
        category: "session" as const,
        turnStatus: "completed" as const,
      };
    }
    if (info?.lastTurnOutcome === "error") {
      return {
        key: "turn",
        label: "Turn",
        value: "Error",
        category: "session" as const,
        turnStatus: "error" as const,
      };
    }
    if (info?.lastTurnOutcome === "cancelled") {
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
    <div
      className={`unified-section-header${isActive ? " unified-section-header--active" : ""}`}
      data-color={color}
      data-is-horizontal={isHorizontal ? "true" : undefined}
      style={{ "--section-accent-color": color } as React.CSSProperties}
    >
      {/* Accent bar — ::before pseudo-element ensures full-height coverage */}
      <div className="unified-section-header-accent" aria-hidden="true" />
      <button
        className="unified-section-header-bar"
        onClick={handleClick}
        type="button"
        style={{
          backgroundColor: activeBg,
        }}
      >
        <span className="unified-section-header-label">{agentId}: {title}</span>
        {/* Inline chips — BottomToolbar style */}
        <span className="section-header-chips">
          {turnChip && <Chip meta={turnChip} />}
          {chips.map((c) => (
            <Chip key={c.key} meta={c} />
          ))}
        </span>
      </button>

      <div className="unified-section-header-actions">
        <button
          className={`unified-section-header-pin${isPinned ? " unified-section-header-pin--active" : ""}`}
          onClick={handleTogglePin}
          type="button"
          title={isPinned ? "Unpin session" : "Pin session"}
        >
          {isPinned ? <IconPinFilled size={14} /> : <IconPin size={14} />}
        </button>

      </div>
    </div>
  );
});
