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

function RenderChat(
  item: ChatDisplayItem,
  sessionId?: string,
  agentId?: string,
  forceHeader?: boolean,
  isNew?: boolean,
  dimmed?: boolean,
) {
  return (
    <Message
      key={item.key}
      item={item}
      isFirstOfTurn={item.isFirstOfTurn}
      sessionId={sessionId}
      agentId={agentId}
      forceHeader={forceHeader}
      isNew={isNew}
      dimmed={dimmed}
    />
  );
}

function RenderCompression(item: CompressionDisplayItem) {
  return (
    <ContextCompressionNotice key={item.key} compressionInfo={item.info} />
  );
}

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
