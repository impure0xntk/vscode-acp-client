import { useSessionStore, sessionKeyOf } from "./sessionStore";
import { useMessageStore } from "./messageStore";

/**
 * ストア間同期ユーティリティ。
 * messageStore の変更を sessionStore へ反映する明示的な橋渡し。
 */

/**
 * 特定セッションの messageCount を messageStore から sessionStore へ同期する。
 * session/message や session/streamEnd のハンドラから呼ぶ。
 */
export function syncMessageCount(agentId: string, sessionId: string): void {
  const msgKey = sessionKeyOf(agentId, sessionId);
  const msgs = useMessageStore.getState().perSession[msgKey];
  if (msgs) {
    useSessionStore.getState().updateMessageCount(agentId, sessionId, msgs.length);
  }
}

/**
 * 全セッションの messageCount を同期する。
 * session/switch 後に呼ぶことで、非アクティブセッションのカウントも更新。
 */
export function syncAllMessageCounts(): void {
  const msgStore = useMessageStore.getState();
  const sessStore = useSessionStore.getState();
  for (const [key, msgs] of Object.entries(msgStore.perSession)) {
    const [agentId, sessionId] = key.split(":");
    sessStore.updateMessageCount(agentId, sessionId, msgs.length);
  }
}
