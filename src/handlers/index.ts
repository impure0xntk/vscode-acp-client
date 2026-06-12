// ============================================================================
// Barrel export for event handlers
// ============================================================================

export { wireSessionEvents } from "./session-events";
export type { SessionEventDeps } from "./session-events";

export { wireMessageEvents } from "./message-events";
export type { MessageEventDeps } from "./message-events";

export { wireTaskEvents } from "./task-events";
export type { TaskEventDeps, StateManagerHandle } from "./task-events";
