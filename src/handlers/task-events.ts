// ============================================================================
// Task Event Handlers — StateManager task events → UI updates
//
// Task lifecycle events are emitted by TaskSchedulerService via StateManager.
// These handlers bridge the event bus to VS Code UI (tree, status bar, webview).
// ============================================================================

import type { OrchestrationEvent, OrchestrationEventType } from "../models/orchestration";
import type { TreeProvider } from "../tree/provider";
import type { AgentStatusBar } from "../statusbar/manager";

// ============================================================================
// Dependencies
// ============================================================================

export interface TaskEventDeps {
  treeProvider: TreeProvider;
  statusBar: AgentStatusBar;
  /** Optional: send task status to webview */
  onTaskUpdate?: (event: OrchestrationEvent) => void;
}

// ============================================================================
// Wire from a concrete StateManager instance
// ============================================================================

export interface StateManagerHandle {
  subscribe: (
    type: OrchestrationEventType,
    listener: (e: OrchestrationEvent) => void,
  ) => () => void;
}

export function wireTaskEvents(
  stateManager: StateManagerHandle,
  deps: TaskEventDeps,
): (() => void)[] {
  const { treeProvider, statusBar, onTaskUpdate } = deps;

  const unsubs: (() => void)[] = [];

  unsubs.push(
    stateManager.subscribe("task.created", (event: OrchestrationEvent) => {
      treeProvider.refresh();
      onTaskUpdate?.(event);
    }),
  );

  unsubs.push(
    stateManager.subscribe("task.status_changed", (event: OrchestrationEvent) => {
      treeProvider.refresh();
      onTaskUpdate?.(event);
    }),
  );

  unsubs.push(
    stateManager.subscribe("agent.handoff", (event: OrchestrationEvent) => {
      treeProvider.refresh();
      statusBar.refresh();
      onTaskUpdate?.(event);
    }),
  );

  unsubs.push(
    stateManager.subscribe("error.occurred", (event: OrchestrationEvent) => {
      onTaskUpdate?.(event);
    }),
  );

  return unsubs;
}
