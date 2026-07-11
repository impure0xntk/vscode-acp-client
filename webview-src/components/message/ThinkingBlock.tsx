import React, { useState } from "react";
import { IconBrain } from "../../lib/icons";
import { renderMarkdown } from "../../lib/markdown";
import { getVsCodeApi } from "../../lib/vscodeApi";

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  /** When true, the block is expanded on first render (default collapsed) */
  defaultExpanded?: boolean;
}

export function ThinkingBlock({
  content,
  isStreaming = false,
  defaultExpanded = false,
}: ThinkingBlockProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(defaultExpanded);
  const toggle = () => setIsOpen((v) => !v);

  // Ensure trailing newline for visual separation from subsequent content
  const displayContent = content.endsWith("\n") ? content : content + "\n";

  // Render thinking as markdown so code blocks, lists, and emphasis render
  // like a normal message instead of raw monospace text.
  const html = renderMarkdown(displayContent);

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    const copyBtn = (e.target as HTMLElement).closest('[data-action="copy"]');
    if (copyBtn) {
      const wrapper = copyBtn.closest(
        "[data-code-block-wrapper]"
      ) as HTMLElement | null;
      const codeEl = wrapper?.querySelector("code");
      if (codeEl) {
        e.preventDefault();
        e.stopPropagation();
        try {
          getVsCodeApi().postMessage({
            type: "copyToClipboard",
            text: codeEl.textContent ?? "",
          });
          copyBtn.setAttribute("data-copied", "true");
          setTimeout(() => copyBtn.removeAttribute("data-copied"), 1500);
        } catch {
          /* vscode API not available in test */
        }
      }
      return;
    }
    const anchor = (e.target as HTMLElement).closest(
      "[data-file-path]"
    ) as HTMLElement | null;
    if (!anchor) return;
    e.preventDefault();
    e.stopPropagation();
    const filePath = anchor.dataset.filePath;
    if (!filePath) return;
    const line = anchor.dataset.fileLine
      ? Number(anchor.dataset.fileLine)
      : undefined;
    try {
      getVsCodeApi().postMessage({ type: "openFile", path: filePath, line });
    } catch {
      /* vscode API not available in test */
    }
  };

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
          <div
            className="px-2.5 py-[6px] text-[11px] leading-[1.5] text-fg-muted"
            onClick={handleClick}
          >
            <div
              className="break-words"
              dangerouslySetInnerHTML={{ __html: html }}
            />
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
