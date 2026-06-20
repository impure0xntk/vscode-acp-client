import React, { useState } from "react";
import { IconBrain } from "../../lib/icons";

// ============================================================================
// Props
// ============================================================================

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

// ============================================================================
// ThinkingBlock Component
// ============================================================================

export function ThinkingBlock({
  content,
  isStreaming = false,
}: ThinkingBlockProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = () => setIsOpen((v) => !v);

  return (
    <div className="thinking-block">
      <div className="thinking-block-header" onClick={toggle}>
        <IconBrain size={14} className="thinking-icon" />
        <span className="thinking-label">
          {isStreaming ? "Thinking…" : "Thought"}
        </span>
        <span className={`thinking-chevron ${isOpen ? "open" : ""}`}>▸</span>
      </div>
      <div className={`collapsible ${isOpen ? "collapsible--open" : ""}`}>
        <div className="collapsible-body">
          <div className="thinking-body">
            {content}
            {isStreaming && <span className="cursor-blink">▋</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
