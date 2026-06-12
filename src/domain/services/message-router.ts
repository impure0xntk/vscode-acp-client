// ============================================================================
// Message Router — message history and routing
// ============================================================================

import type { Message, MessageRole } from "../models/message";
import { StateManager } from "./state-manager";

// ============================================================================
// Routing Result
// ============================================================================

export interface RoutingResult {
  handled: boolean;
  sessionId: string;
  message: Message;
}

// ============================================================================
// Message Handler
// ============================================================================

export type MessageHandler = (message: Message) => Promise<boolean>;

// ============================================================================
// Message Router Service
// ============================================================================

export class MessageRouterService {
  // sessionId → Message[]
  private history: Map<string, Message[]> = new Map();
  // role → handler
  private handlers: Map<MessageRole, MessageHandler> = new Map();
  private stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  // ========================================================================
  // Routing
  // ========================================================================

  async route(message: Message): Promise<RoutingResult> {
    const handler = this.handlers.get(message.role);
    const handled = handler ? await handler(message) : false;

    // Always add to history
    this.addMessage(message.sessionId, message);

    const event = this.stateManager.createEvent(
      message.role === "user" ? "message.received" : "message.sent",
      { sessionId: message.sessionId, messageId: message.id },
    );
    this.stateManager.applyEvent(event);

    return { handled, sessionId: message.sessionId, message };
  }

  // ========================================================================
  // Handler Registration
  // ========================================================================

  registerHandler(role: MessageRole, handler: MessageHandler): void {
    this.handlers.set(role, handler);
  }

  unregisterHandler(role: MessageRole): void {
    this.handlers.delete(role);
  }

  // ========================================================================
  // History
  // ========================================================================

  getHistory(sessionId: string): Message[] {
    return this.history.get(sessionId) ?? [];
  }

  addMessage(sessionId: string, message: Message): void {
    let messages = this.history.get(sessionId);
    if (!messages) {
      messages = [];
      this.history.set(sessionId, messages);
    }
    messages.push(message);
  }

  clearHistory(sessionId: string): void {
    this.history.delete(sessionId);
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    this.history.clear();
    this.handlers.clear();
  }
}
