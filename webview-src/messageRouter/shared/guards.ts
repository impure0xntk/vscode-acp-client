import { sessionKeyOf } from "../../store/sessionStore";

/** Guard key for pending session switch requests. */
export let pendingSwitchGuard: string | null = null;

/** Pending snapshot key set by handleSessionSnapshot, cleared by handleSetTabs. */
export let pendingSnapshotKey: string | null = null;

export function setPendingSwitchGuard(key: string | null): void {
  pendingSwitchGuard = key;
}

export function setPendingSnapshotKey(key: string | null): void {
  pendingSnapshotKey = key;
}

/**
 * Public API: set the pending switch guard for a session.
 * Called from AppContainer when the user triggers a session switch.
 */
export function setPendingSwitch(agentId: string, sessionId: string): void {
  pendingSwitchGuard = sessionKeyOf(agentId, sessionId);
}
