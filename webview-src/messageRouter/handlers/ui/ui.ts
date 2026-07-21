import { useUiStateStore } from "../../../store/uiStateStore";
import { getLogger } from "../../../lib/logger";

const log = getLogger("handlers.ui");

interface SessionOverviewStateMessage {
  type: "sessionOverview:state";
  payload: import("../../../types").SessionOverviewState;
}

interface SessionOverviewToggleMessage {
  type: "sessionOverview:toggle";
  payload: { visible: boolean };
}

interface SessionOverviewPositionMessage {
  type: "sessionOverview:position";
  payload: { position: "right" | "left" };
}

interface UnifiedChatSetSplitDirectionMessage {
  type: "unifiedChat:setSplitDirection";
  direction: "horizontal" | "vertical";
}

interface PanelModeSetMessage {
  type: "panelMode:set";
  mode: "unified" | "supervisor";
}

interface ComposerFocusMessage {
  type: "composer:focus";
}

export function handleSessionOverviewState(
  data: SessionOverviewStateMessage
): void {
  useUiStateStore.getState().setOverviewState(data.payload);
}

export function handleSessionOverviewToggle(
  data: SessionOverviewToggleMessage
): void {
  useUiStateStore.getState().setOverviewVisible(data.payload.visible);
}

export function handleSessionOverviewPosition(
  data: SessionOverviewPositionMessage
): void {
  useUiStateStore.getState().setOverviewPosition(data.payload.position);
}

export function handleUnifiedChatSetSplitDirection(
  data: UnifiedChatSetSplitDirectionMessage
): void {
  if (data.direction !== "horizontal" && data.direction !== "vertical") return;
  log.info("unifiedChat:setSplitDirection", { direction: data.direction });
  useUiStateStore.getState().setSplitDirection(data.direction);
}

export function handlePanelModeSet(data: PanelModeSetMessage): void {
  log.info("panelMode:set", { mode: data.mode });
  useUiStateStore.getState().setPanelMode(data.mode);
}

export function handleComposerFocus(_data: ComposerFocusMessage): void {
  requestAnimationFrame(() => {
    const textarea =
      document.querySelector<HTMLTextAreaElement>(".composer textarea");
    if (textarea) {
      textarea.focus();
      const len = textarea.value.length;
      textarea.selectionStart = len;
      textarea.selectionEnd = len;
    }
  });
}
