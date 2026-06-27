// ============================================================================
// Task Event Handlers — StateManager task events → UI updates
//
// Task lifecycle events are emitted by TaskSchedulerService via StateManager.
// These handlers bridge the event bus to VS Code UI (webview).
// ============================================================================

import type {
  OrchestrationEvent,
  OrchestrationEventType,
} from "../../domain/models/orchestration";



// ============================================================================
// Dependencies
// ============================================================================

export interface TaskEventDeps {
  /** Optional: send task status to webview */
  onTaskUpdate?: (event: OrchestrationEvent) => void;
}

// ============================================================================
// Wire from a concrete StateManager instance
// ============================================================================

export interface StateManagerHandle {
  subscribe: (
    type: OrchestrationEventType,
    listener: (e: OrchestrationEvent) => void
  ) => () => void;
}

export function wireTaskEvents(
  stateManager: StateManagerHandle,
  deps: TaskEventDeps
): (() => void)[] {
  const { onTaskUpdate } = deps;

  const unsubs: (() => void)[] = [];

  unsubs.push(
    stateManager.subscribe("task.created", (event: OrchestrationEvent) => {
      onTaskUpdate?.(event);
    })
  );

  unsubs.push(
    stateManager.subscribe(
      "task.status_changed",
      (event: OrchestrationEvent) => {
        onTaskUpdate?.(event);
      }
    )
  );

  unsubs.push(
    stateManager.subscribe("agent.handoff", (event: OrchestrationEvent) => {
      onTaskUpdate?.(event);
    })
  );

  unsubs.push(
    stateManager.subscribe("error.occurred", (event: OrchestrationEvent) => {
      onTaskUpdate?.(event);
    })
  );

  return unsubs;
}
