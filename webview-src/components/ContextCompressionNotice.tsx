import React from "react";
import { Icon } from "../lib/icons";
import type { SessionCompressionInfo } from "../types";

// ============================================================================
// Props
// ============================================================================

interface ContextCompressionNoticeProps {
  compressionInfo: SessionCompressionInfo;
}

// ============================================================================
// Helpers
// ============================================================================

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ============================================================================
// ContextCompressionNotice Component
// ============================================================================

export function ContextCompressionNotice({
  compressionInfo,
}: ContextCompressionNoticeProps): React.ReactElement {
  const { contextWindowMax, usedTokens, usedBefore } = compressionInfo;

  const percentage =
    contextWindowMax > 0 ? Math.round((usedTokens / contextWindowMax) * 100) : 0;
  const beforePercentage =
    usedBefore && contextWindowMax > 0
      ? Math.round((usedBefore / contextWindowMax) * 100)
      : null;
  const saved = usedBefore ? usedBefore - usedTokens : 0;

  return (
    <div className="context-compression-notice" role="status" aria-live="polite">
      <div className="context-compression-icon-wrap">
        <Icon name="compress" size="sm" className="context-compression-icon" />
      </div>
      <div className="context-compression-body">
        <span className="context-compression-label">Context compressed</span>
        <span className="context-compression-detail">
          {beforePercentage !== null && (
            <span className="context-compression-before">{beforePercentage}%</span>
          )}
          {beforePercentage !== null && (
            <span className="context-compression-arrow"> → </span>
          )}
          <span className="context-compression-after">{percentage}%</span>
          <span className="context-compression-tokens">
            {" "}
            ({formatTokens(usedTokens)} / {formatTokens(contextWindowMax)} tokens)
          </span>
        </span>
        {saved > 0 && (
          <span className="context-compression-saved">
            {formatTokens(saved)} tokens freed
          </span>
        )}
      </div>
    </div>
  );
}
