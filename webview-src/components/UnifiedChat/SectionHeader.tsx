import React, { useCallback, useRef, useState } from "react";
import { useLogger } from "../../hooks/useLogger";
import { StatusIcon } from "../StatusIcon";

export interface SectionHeaderProps {
  sessionKey: string;
  agentId: string;
  title: string;
  status: "idle" | "running" | "completed" | "error" | "cancelled";
  color: string;
  isStreaming: boolean;
  isTurnActive: boolean;
  messageCount: number;
  isActive: boolean;
  isPinned: boolean;
  onClick: () => void;
  onTogglePin: () => void;
  onClose: () => void;
}

export const SectionHeader = React.memo(function SectionHeader({
  sessionKey,
  agentId,
  title,
  status,
  color,
  isStreaming,
  isTurnActive,
  messageCount,
  isActive,
  isPinned,
  onClick,
  onTogglePin,
  onClose,
}: SectionHeaderProps): React.ReactElement {
  const log = useLogger("SectionHeader");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  log.debug("render", { sessionKey, agentId, status, isActive, isPinned, messageCount });

  return (
    <div
      className={`unified-section-header${isActive ? " unified-section-header--active" : ""}`}
    >
      <button
        className="unified-section-header-bar"
        onClick={handleClick}
        type="button"
        style={{
          borderLeftColor: color,
          backgroundColor: `${color}14`,
        }}
      >
        <span className="unified-section-header-agent">{agentId}</span>
        <StatusIcon status={status} size="sm" />
        <span className="unified-section-header-title">{title}</span>
        {isStreaming && (
          <span className="unified-section-header-streaming">streaming</span>
        )}
        {isTurnActive && (
          <span className="unified-section-header-turn">turn</span>
        )}
        <span className="unified-section-header-count">({messageCount})</span>
      </button>
      <div className="unified-section-header-actions">
        <button
          className={`unified-section-header-pin${isPinned ? " unified-section-header-pin--active" : ""}`}
          onClick={handleTogglePin}
          type="button"
          title={isPinned ? "Unpin session" : "Pin session"}
        >
          {isPinned ? "📌" : "📍"}
        </button>
        <div className="unified-section-header-menu" ref={menuRef}>
          <button
            className="unified-section-header-menu-btn"
            onClick={handleMenuToggle}
            type="button"
            title="Section options"
          >
            ⋮
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
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
