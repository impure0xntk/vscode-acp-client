import React from "react";
import { Icon } from "../../lib/icons";
import type { SessionCompressionInfo } from "../../types";

interface ContextCompressionNoticeProps {
  compressionInfo: SessionCompressionInfo;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ContextCompressionNotice({
  compressionInfo,
}: ContextCompressionNoticeProps): React.ReactElement {
  const { contextWindowMax, usedTokens, usedBefore } = compressionInfo;

  const percentage =
    contextWindowMax > 0
      ? Math.round((usedTokens / contextWindowMax) * 100)
      : 0;
  const beforePercentage =
    usedBefore && contextWindowMax > 0
      ? Math.round((usedBefore / contextWindowMax) * 100)
      : null;
  const saved = usedBefore ? usedBefore - usedTokens : 0;

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[11px] leading-[1.4]"
      role="status"
      aria-live="polite"
    >
      <div className="flex-shrink-0 flex items-center justify-center text-accent">
        <Icon name="compress" size="sm" className="text-[13px]" />
      </div>
      <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
        <span className="font-medium text-fg-secondary whitespace-nowrap">Context compressed</span>
        <span className="inline-flex items-baseline gap-0.5 font-mono text-[10px] text-fg-muted tabular-nums">
          {beforePercentage !== null && (
            <span className="text-warning line-through opacity-70">
              {beforePercentage}%
            </span>
          )}
          {beforePercentage !== null && (
            <span className="text-fg-muted opacity-50 text-[10px]"> → </span>
          )}
          <span className="text-fg-primary font-medium">{percentage}%</span>
          <span className="text-fg-muted opacity-70">
            {" "}
            ({formatTokens(usedTokens)} / {formatTokens(contextWindowMax)}{" "}
            tokens)
          </span>
        </span>
        {saved > 0 && (
          <span className="text-[10px] text-fg-muted opacity-60 whitespace-nowrap">
            {formatTokens(saved)} tokens freed
          </span>
        )}
      </div>
    </div>
  );
}
