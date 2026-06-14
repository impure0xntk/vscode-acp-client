import { useSessionStore, sessionKeyOf } from "./sessionStore";
import { useMessageStore } from "./messageStore";

/**
 * Inter-store synchronization utility.
 * Explicitly bridges changes in messageStore to sessionStore.
 */

/**
 * Synchronizes the messageCount of a specific session to sessionStore.
 * Uses the produce-based updateMessageCount action so that sessionInfoMap
 * reference is only created when the count actually changes, preventing
 * unnecessary re-renders from useSyncExternalStore subscriptions.
 */
export function syncMessageCount(agentId: string, sessionId: string): void {
  const msgKey = sessionKeyOf(agentId, sessionId);
  const msgs = useMessageStore.getState().perSession[msgKey];
  if (!msgs) return;
  const store = useSessionStore.getState();
  const existing = store.sessionInfoMap[msgKey];
  const newCount = msgs.length;
  if (existing && existing.messageCount !== newCount) {
    store.updateMessageCount(agentId, sessionId, newCount);
  } else if (!existing) {
    store.updateMessageCount(agentId, sessionId, newCount);
  }
}


