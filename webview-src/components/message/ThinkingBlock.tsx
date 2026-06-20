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

  return (
    <div className="my-1 rounded overflow-hidden bg-bg-secondary text-sm">
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 cursor-pointer select-none text-fg-secondary text-[11px] hover:bg-accent-hover"
        onClick={toggle}
      >
        <IconBrain size={14} className="flex-shrink-0 text-xs" />
        <span className="flex-1 italic">
          {isStreaming ? "Thinking…" : "Thought"}
        </span>
        <span
          className={`flex-shrink-0 text-[10px] transition-transform duration-150${isOpen ? " rotate-90" : ""}`}
        >
          ▸
        </span>
      </div>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="px-3 py-2 font-mono text-[11px] leading-[1.5] text-fg-secondary whitespace-pre-wrap break-words">
            {content}
            {isStreaming && (
              <span className="inline-block animate-[blink_1s_step-end_infinite] text-accent font-bold">
                ▋
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
