// ============================================================================
// MessageBus — in-process pub/sub for P2P agent communication
//
// refs: docs/p2p-mesh-design.md Section 5.1
// ============================================================================

import type { P2PMessage } from "../models/mesh";
import { getLogger } from "../../platform/backends";

const log = getLogger("message-bus");

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type MessageHandler = (message: P2PMessage) => Promise<void>;
export type Unsubscribe = () => void;

// ----------------------------------------------------------------------------
// MessageBus
// ----------------------------------------------------------------------------

export class MessageBus {
  // agentId → Set<handler>
  private subscribers: Map<string, Set<MessageHandler>> = new Map();
  // queued messages for offline agents: agentId → P2PMessage[]
  private queues: Map<string, P2PMessage[]> = new Map();
  private log: MessageLogEntry[] = [];

  // -----------------------------------------------------------------------
  // Subscription
  // -----------------------------------------------------------------------

  subscribe(agentId: string, handler: MessageHandler): Unsubscribe {
    let set = this.subscribers.get(agentId);
    if (!set) {
      set = new Set();
      this.subscribers.set(agentId, set);
    }
    set.add(handler);

    // Drain queued messages on subscribe
    this.drainQueue(agentId, handler);

    return () => {
      this.subscribers.get(agentId)?.delete(handler);
    };
  }

  // -----------------------------------------------------------------------
  // Send
  // -----------------------------------------------------------------------

  async send(message: P2PMessage): Promise<void> {
    log.debug("send", {
      from: message.from,
      to: message.to,
      type: message.type,
    });
    this.pushLog(message);

    // Broadcast
    if (message.to === "broadcast") {
      for (const [agentId, handlers] of this.subscribers) {
        if (agentId === message.from) continue;
        await this.dispatchToSet(handlers, message);
      }
      return;
    }

    // Directed
    const handlers = this.subscribers.get(message.to);
    if (handlers && handlers.size > 0) {
      await this.dispatchToSet(handlers, message);
    } else {
      log.debug("no subscriber, queuing", { to: message.to });
      await this.queue(message);
    }
  }

  /**
   * Send a message to multiple specific targets.
   * Each target receives the same message independently.
   */
  async sendToMultiple(targets: string[], message: P2PMessage): Promise<void> {
    this.pushLog(message);
    for (const target of targets) {
      const handlers = this.subscribers.get(target);
      if (handlers && handlers.size > 0) {
        await this.dispatchToSet(handlers, message);
      } else {
        await this.queue(message);
      }
    }
  }

  /**
   * Broadcast shorthand — sets `to: "broadcast"` and sends.
   */
  async broadcast(message: P2PMessage): Promise<void> {
    await this.send({ ...message, to: "broadcast" });
  }

  /**
   * Return the most recent N log entries (newest first).
   */
  getRecentLogs(limit: number): ReadonlyArray<MessageLogEntry> {
    if (limit >= this.log.length) return [...this.log];
    return this.log.slice(this.log.length - limit);
  }

  // -----------------------------------------------------------------------
  // Queue management
  // -----------------------------------------------------------------------

  private async queue(message: P2PMessage): Promise<void> {
    const q = this.queues.get(message.to) ?? [];
    q.push(message);
    this.queues.set(message.to, q);
  }

  private drainQueue(agentId: string, handler: MessageHandler): void {
    const q = this.queues.get(agentId);
    if (!q || q.length === 0) return;
    this.queues.delete(agentId);
    for (const msg of q) {
      // Fire-and-forget; errors swallowed to avoid blocking subscribe()
      void handler(msg);
    }
  }

  getQueuedCount(agentId: string): number {
    return this.queues.get(agentId)?.length ?? 0;
  }

  clearQueue(agentId: string): void {
    this.queues.delete(agentId);
  }

  // -----------------------------------------------------------------------
  // Log
  // -----------------------------------------------------------------------

  getLog(): ReadonlyArray<MessageLogEntry> {
    return this.log;
  }

  private pushLog(message: P2PMessage): void {
    this.log.push({
      messageId: message.id,
      type: message.type,
      from: message.from,
      to: message.to,
      timestamp: message.timestamp,
      summary: summarize(message),
    });
  }

  clearLog(): void {
    this.log = [];
  }

  // -----------------------------------------------------------------------
  // Internal dispatch
  // -----------------------------------------------------------------------

  private async dispatchToSet(
    handlers: Set<MessageHandler>,
    message: P2PMessage
  ): Promise<void> {
    for (const h of handlers) {
      try {
        await h(message);
      } catch (e) {
        log.error(
          "handler error",
          { to: message.to, type: message.type },
          e as Error
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Teardown
  // -----------------------------------------------------------------------

  dispose(): void {
    this.subscribers.clear();
    this.queues.clear();
    this.log = [];
  }
}

// ----------------------------------------------------------------------------
// Internal log entry (kept private; exposed via getLog())
// ----------------------------------------------------------------------------

interface MessageLogEntry {
  messageId: string;
  type: string;
  from: string;
  to: string;
  timestamp: Date;
  summary: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function summarize(msg: P2PMessage): string {
  switch (msg.type) {
    case "task_request":
      return `Task request: ${(msg.payload as { title?: string }).title ?? "?"}`;
    case "task_response":
      return `Task response: ${(msg.payload as { status?: string }).status ?? "?"}`;
    default:
      return `${msg.type} from ${msg.from}`;
  }
}
