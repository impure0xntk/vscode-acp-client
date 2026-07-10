import React, { useState } from "react";
import { IconBrain } from "../../lib/icons";

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({
  content,
  isStreaming = false,
}: ThinkingBlockProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = () => setIsOpen((v) => !v);

  // Ensure trailing newline for visual separation from subsequent content
  const displayContent = content.endsWith("\n") ? content : content + "\n";

  return (
    <div className="my-[2px] rounded overflow-hidden bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] text-sm border border-[color-mix(in_srgb,var(--border)_30%,transparent)]">
      <div
        className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer select-none text-fg-muted text-[11px] hover:bg-accent-hover"
        onClick={toggle}
      >
        <span
          className={`flex-shrink-0 text-[9px] opacity-60 transition-transform duration-150${isOpen ? " rotate-90" : ""}`}
          aria-hidden="true"
        >
          ▶
        </span>
        <IconBrain size={14} className="flex-shrink-0 opacity-70" />
        <span className="flex-1 italic">
          {isStreaming ? "Thinking…" : "Thought"}
        </span>
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <div className="px-2.5 py-[6px] font-mono text-[11px] leading-[1.5] text-fg-muted whitespace-pre-wrap break-words">
            {displayContent}
            {isStreaming && (
              <span className="inline-block animate-blink text-accent font-bold">
                ▋
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
