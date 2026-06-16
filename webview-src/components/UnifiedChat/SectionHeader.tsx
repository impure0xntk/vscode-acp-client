import React, { useCallback, useRef, useState, useEffect } from "react";
import { useLogger } from "../../hooks/useLogger";
import { StatusIcon } from "../StatusIcon";
import type { StatusIconType, TurnOutcome } from "../StatusIcon";
import type { SessionInfoDTO } from "../../store/sessionStore";
import { IconPin, IconPinFilled, IconMoreVertical, IconCross } from "../../lib/icons";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Local tick for elapsedMs — recompute every second while running.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (info?.status !== "running" || !info?.lastResponseAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [info?.status, info?.lastResponseAt]);

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

  const handleMenuToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setMenuOpen((prev) => !prev);
    },
    [],
  );

  const handleMenuClose = useCallback(() => {
    setMenuOpen(false);
  }, []);

  // Close menu on outside click
  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Compute effective status from info
  const rawStatus = info?.status ?? status;
  const lastOutcome: TurnOutcome | null = info?.lastTurnOutcome ?? null;
  const effectiveStatus: StatusIconType =
    rawStatus === "running"
      ? "running"
      : rawStatus === "idle" && lastOutcome
        ? lastOutcome
        : rawStatus === "idle"
          ? "idle"
          : rawStatus;

  const elapsedMs =
    effectiveStatus === "running" && info?.lastResponseAt
      ? Date.now() - new Date(info.lastResponseAt).getTime()
      : undefined;

  // Token usage percentage
  const tokenPercentage =
    info?.contextWindowMax && info.contextWindowMax > 0
      ? Math.round((info.tokenUsage.totalTokens / info.contextWindowMax) * 100)
      : null;

  // Accent edge: horizontal split (side-by-side) → top border on header,
  //              vertical split (stacked) → left border on header
  const isHorizontal = splitDirection === "horizontal";

  return (
    <div
      className={`unified-section-header${isActive ? " unified-section-header--active" : ""}${isActive && isHorizontal ? " unified-section-header--active-h" : ""}${isActive && !isHorizontal ? " unified-section-header--active-v" : ""}`}
    >
      <button
        className="unified-section-header-bar"
        onClick={handleClick}
        type="button"
        style={{
          borderLeftColor: !isHorizontal ? color : "transparent",
          borderTopColor: isHorizontal ? color : "transparent",
          backgroundColor: isActive ? `${color}20` : `${color}14`,
        }}
      >
        <StatusIcon status={effectiveStatus} elapsedMs={elapsedMs} size="sm" />
        <span className="unified-section-header-label">{agentId}: {title}</span>
        <span className="unified-section-header-count">({messageCount})</span>
      </button>

      {/* Token usage mini bar */}
      {tokenPercentage !== null && (
        <div className="section-header-token-bar" title={`${tokenPercentage}% context used`}>
          <div
            className={`section-header-token-bar-fill${tokenPercentage >= 90 ? " section-header-token-bar-fill--critical" : tokenPercentage >= 70 ? " section-header-token-bar-fill--warning" : ""}`}
            style={{ width: `${Math.min(tokenPercentage, 100)}%` }}
          />
        </div>
      )}

      <div className="unified-section-header-actions">
        <button
          className={`unified-section-header-pin${isPinned ? " unified-section-header-pin--active" : ""}`}
          onClick={handleTogglePin}
          type="button"
          title={isPinned ? "Unpin session" : "Pin session"}
        >
          {isPinned ? <IconPinFilled size={14} /> : <IconPin size={14} />}
        </button>
        <div className="unified-section-header-menu" ref={menuRef}>
          <button
            className="unified-section-header-menu-btn"
            onClick={handleMenuToggle}
            type="button"
            title="Section options"
          >
            <IconMoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className="unified-section-header-menu-dropdown">
              <button
                className="unified-section-header-menu-item"
                onClick={(e) => {
                  handleTogglePin(e);
                  handleMenuClose();
                }}
                type="button"
              >
                {isPinned ? "Unpin" : "Pin"}
              </button>
              <button
                className="unified-section-header-menu-item unified-section-header-menu-item--danger"
                onClick={(e) => {
                  handleClose(e);
                  handleMenuClose();
                }}
                type="button"
              >
                <IconCross size={12} style={{ marginRight: 6, display: "inline-block", verticalAlign: "middle" }} />
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
