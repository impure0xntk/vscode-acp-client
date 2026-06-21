import React from "react";
import { Message } from "./Message";
import { ContextCompressionNotice } from "../composer/ContextCompressionNotice";
import type {
  PipelineItem,
  ChatDisplayItem,
  CompressionDisplayItem,
  ModeChangeDisplayItem,
  ErrorNoticeDisplayItem,
  CustomSystemDisplayItem,
} from "../../pipeline";

// ── Props ──────────────────────────────────────────────────────────────────

export interface DisplayItemViewProps {
  item: PipelineItem;
  idx: number;
  items: PipelineItem[];
  sessionId?: string;
  agentId?: string;
  /** When true, always show the message header for chat items */
  forceHeader?: boolean;
  /** When true, apply appear animation (only for newly added messages) */
  isNew?: boolean;
  /** When true, render at reduced opacity to distinguish from final response */
  dimmed?: boolean;
}

// ── Chat item ───────────────────────────────────────────────────────────────

function RenderChat(
  item: ChatDisplayItem,
  sessionId?: string,
  agentId?: string,
  forceHeader?: boolean,
  isNew?: boolean,
  dimmed?: boolean
) {
  return (
    <Message
      key={item.key}
      item={item}
      isConsecutive={item.isConsecutive}
      sessionId={sessionId}
      agentId={agentId}
      forceHeader={forceHeader}
      isNew={isNew}
      dimmed={dimmed}
    />
  );
}

// ── Compression notice ──────────────────────────────────────────────────────

function RenderCompression(item: CompressionDisplayItem) {
  return (
    <ContextCompressionNotice key={item.key} compressionInfo={item.info} />
  );
}

// ── Mode change ─────────────────────────────────────────────────────────────

function RenderModeChange(item: ModeChangeDisplayItem) {
  return (
    <div
      key={item.key}
      className="flex items-center justify-center py-2 px-4 text-[11px] text-fg-muted italic border-b border-[color-mix(in_srgb,var(--border)_40%,transparent)]"
    >
      {item.content}
    </div>
  );
}

// ── Error notice ────────────────────────────────────────────────────────────

function RenderErrorNotice(item: ErrorNoticeDisplayItem) {
  return (
    <div
      key={item.key}
      className="flex items-center justify-center py-2 px-4 text-[11px] text-error bg-[color-mix(in_srgb,var(--error)_8%,transparent)] border-b border-[color-mix(in_srgb,var(--error)_15%,transparent)]"
    >
      {item.content}
    </div>
  );
}

// ── Custom system ───────────────────────────────────────────────────────────

function RenderCustom(item: CustomSystemDisplayItem) {
  return (
    <div
      key={item.key}
      className="flex items-center justify-center py-2 px-4 text-[11px] text-fg-secondary italic border-b border-[color-mix(in_srgb,var(--border)_40%,transparent)]"
    >
      {item.content}
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
  idx: _idx,
  items: _items,
  sessionId,
  agentId,
  forceHeader = false,
  isNew = false,
  dimmed = false,
}: DisplayItemViewProps): React.ReactElement {
  switch (item.type) {
    case "chat":
      return RenderChat(item, sessionId, agentId, forceHeader, isNew, dimmed);
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
