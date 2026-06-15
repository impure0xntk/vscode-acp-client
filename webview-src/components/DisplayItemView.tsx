import React from "react";
import { Message } from "./Message";
import { ContextCompressionNotice } from "./ContextCompressionNotice";
import type {
  PipelineItem,
  ChatDisplayItem,
  CompressionDisplayItem,
  ModeChangeDisplayItem,
  ErrorNoticeDisplayItem,
  CustomSystemDisplayItem,
} from "../pipeline";

// ── Props ──────────────────────────────────────────────────────────────────

export interface DisplayItemViewProps {
  item: PipelineItem;
  idx: number;
  items: PipelineItem[];
  sessionId?: string;
}

// ── Chat item: resolve consecutiveness ──────────────────────────────────────

function RenderChat(item: ChatDisplayItem, idx: number, items: PipelineItem[], sessionId?: string) {
  const prev = items[idx - 1];
  const isConsecutive =
    prev?.type === "chat" &&
    prev.role === "agent" &&
    item.role === "agent" &&
    prev.key.split("-").slice(1).join("-") ===
      item.key.split("-").slice(1).join("-");

  return (
    <Message
      key={item.key}
      item={item}
      isConsecutive={isConsecutive}
      sessionId={sessionId}
    />
  );
}

// ── Compression notice ──────────────────────────────────────────────────────

function RenderCompression(item: CompressionDisplayItem) {
  return (
    <ContextCompressionNotice
      key={item.key}
      compressionInfo={item.info}
    />
  );
}

// ── Mode change ─────────────────────────────────────────────────────────────

function RenderModeChange(item: ModeChangeDisplayItem) {
  return (
    <div
      key={item.key}
      className="message message-system message-mode-change"
    >
      <span className="message-mode-change-label">{item.content}</span>
    </div>
  );
}

// ── Error notice ────────────────────────────────────────────────────────────

function RenderErrorNotice(item: ErrorNoticeDisplayItem) {
  return (
    <div
      key={item.key}
      className="message message-system message-error-notice"
    >
      <span className="message-error-notice-label">{item.content}</span>
    </div>
  );
}

// ── Custom system ───────────────────────────────────────────────────────────

function RenderCustom(item: CustomSystemDisplayItem) {
  return (
    <div key={item.key} className="message message-system message-custom">
      <span className="message-custom-label">{item.content}</span>
    </div>
  );
}

// ── DisplayItemView ────────────────────────────────────────────────────────-

/**
 * Renders a PipelineItem by selecting the appropriate component per tag.
 * This is the single place where the mapping from pipeline output to UI lives.
 */
export function DisplayItemView({
  item,
  idx,
  items,
  sessionId,
}: DisplayItemViewProps): React.ReactElement {
  switch (item.type) {
    case "chat":
      return RenderChat(item, idx, items, sessionId);
    case "compression":
      return RenderCompression(item);
    case "mode_change":
      return RenderModeChange(item);
    case "error_notice":
      return RenderErrorNotice(item);
    case "custom":
      return RenderCustom(item);
  }
}
