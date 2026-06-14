import React, { useCallback, useState } from "react";
import { getVsCodeApi } from "../lib/vscodeApi";
import { getLogger } from "../lib/logger";
import { IconCheck, IconCopy } from "../lib/icons";

const log = getLogger("webview.component.MessageActions");

export interface MessageActionsProps {
  messageId: string;
  content: string;
  isUserMessage: boolean;
  sessionId: string;
}

export function MessageActions({
  content,
}: MessageActionsProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    try {
      getVsCodeApi().postMessage({ type: "copyToClipboard", text: content });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      log.error("copy failed", { error: (err as Error).message });
    }
  }, [content]);

  return (
    <span className="message-actions-inline" role="toolbar" aria-label="Message actions">
      <button
        className="message-action-inline-btn"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy to clipboard"}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
      >
        {copied ? (
          <IconCheck size={12} />
        ) : (
          <IconCopy size={12} />
        )}
      </button>
    </span>
  );
}
