import React, { useEffect, useRef, memo } from "react";
import { Message } from "./Message";
import type { ChatMessage } from "../types";

export interface ChatContainerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionId?: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
}

function sessionIdFrom(msg: ChatMessage): string {
  return msg.sessionId ?? "__nosession__";
}

/**
 * Merge consecutive adjacent tool messages that share the same sessionId
 * into a single entry whose `toolCalls` is the concatenation of all
 * original toolCalls and whose content is joined with "\n".
 *
 * A non-tool message or a sessionId boundary breaks the merge, so tool
 * messages from different sessions are never combined.
 *
 * The returned array has the same length or fewer entries than `messages`.
 */
function mergeSameSessionTools(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role !== "tool") {
      result.push(msg);
      continue;
    }
    const last = result[result.length - 1];
    // Only merge when both sides have an explicit (non-placeholder) sessionId
    const sid = sessionIdFrom(msg);
    if (
      last !== undefined &&
      last.role === "tool" &&
      sid !== "__nosession__" &&
      sessionIdFrom(last) === sid
    ) {
      result[result.length - 1] = {
        ...last,
        toolCalls: [...(last.toolCalls ?? []), ...(msg.toolCalls ?? [])],
        content: [last.content, msg.content].filter(Boolean).join("\n"),
      };
    } else {
      result.push(msg);
    }
  }
  return result;
}

/**
 * Build an array aligned to `messages` that carries the inherited
 * "run key" for each slot.  Adjacent messages with the same run key
 * belong to the same consecutive run and the later one hides its header.
 *
 * The run key is `"sessionId::agentId"` where:
 *   - non-tool messages:  sessionId = msg.sessionId, agentId = msg.agentId
 *   - tool messages:      sessionId and agentId are inherited from the most
 *                         recent non-tool message before them
 *
 * After merging same-session tools this means:
 *   agent(id:A,sess:X) → [merged tool+sess:X] → agent(id:A,sess:X)
 * produces the same run key for every slot, so only the first shows a header.
 *
 * `undefined` means the slot cannot participate in any run (no agentId).
 */
function buildRunKeys(messages: ChatMessage[]): (string | undefined)[] {
  const result: (string | undefined)[] = [];
  // Track the last known agentId and sessionId from non-tool messages.
  // Tool messages inherit both so that agent→tool→tool→agent is one run.
  let lastAgentId: string | undefined = undefined;
  let lastSessionId: string | undefined = undefined;
  for (const msg of messages) {
    if (msg.role === "tool") {
      // Inherit from the preceding non-tool message
      result.push(
        lastAgentId !== undefined && lastSessionId !== undefined
          ? `${lastSessionId}::${lastAgentId}`
          : undefined,
      );
    } else {
      lastAgentId = msg.agentId;
      lastSessionId = sessionIdFrom(msg);
      result.push(
        msg.agentId !== undefined && lastSessionId !== undefined
          ? `${lastSessionId}::${msg.agentId}`
          : undefined,
      );
    }
  }
  return result;
}

// Memoize to skip re-render when isStreaming toggles but messages reference is same
export const ChatContainer = memo(function ChatContainer({
  messages,
  isStreaming,
  sessionId,
  status,
}: ChatContainerProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevSessionIdRef = useRef<string | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset scroll position when switching sessions
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId && sessionId) {
      prevSessionIdRef.current = sessionId;
    }
  }, [sessionId]);

  // Auto-scroll on new messages or streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const isEmpty = messages.length === 0;

  // Merge same-session tool messages, then compute run keys
  const merged = mergeSameSessionTools(messages);
  const runKeys = buildRunKeys(merged);

  return (
    <div className="chat-container" ref={containerRef}>
      {isEmpty ? (
        <div className="empty-state">
          <p className="empty-title">ACP Chat</p>
          <p className="empty-hint">
            {sessionId
              ? "Send a message to start the conversation."
              : "Connect to an agent and create a session to start."}
          </p>
        </div>
      ) : (
        <div className="message-list">
          {merged.map((msg, idx) => {
            if (idx === 0) {
              return (
                <Message
                  key={msg.id}
                  id={msg.id}
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.timestamp}
                  toolCalls={msg.toolCalls}
                  inlineFilePaths={msg.inlineFilePaths}
                  attachments={msg.attachments}
                  isConsecutive={false}
                />
              );
            }
            const key = runKeys[idx];
            const keyPrev = runKeys[idx - 1];
            const isConsecutive = key !== undefined && key === keyPrev;
            return (
              <Message
                key={msg.id}
                id={msg.id}
                role={msg.role}
                content={msg.content}
                timestamp={msg.timestamp}
                toolCalls={msg.toolCalls}
                inlineFilePaths={msg.inlineFilePaths}
                attachments={msg.attachments}
                isConsecutive={isConsecutive}
              />
            );
          })}
          {isStreaming && (
            <div className="streaming-cursor">
              <span className="cursor-blink">▋</span>
            </div>
          )}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
});
