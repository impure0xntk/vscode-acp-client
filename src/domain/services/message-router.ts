import type { Message, MessageRole } from "../models/message";
import { StateManager } from "./state-manager";
import { getLogger } from "../../platform/backends";

export interface RoutingResult {
  handled: boolean;
  sessionId: string;
  message: Message;
}

export type MessageHandler = (message: Message) => Promise<boolean>;

export class MessageRouterService {
  private history: Map<string, Message[]> = new Map();
  private handlers: Map<MessageRole, MessageHandler> = new Map();
  private stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  async route(message: Message): Promise<RoutingResult> {
    const handler = this.handlers.get(message.role);
    const handled = handler ? await handler(message) : false;

    this.addMessage(message.sessionId, message);

    const event = this.stateManager.createEvent(
      message.role === "user" ? "message.received" : "message.sent",
      { sessionId: message.sessionId, messageId: message.id }
    );
    this.stateManager.applyEvent(event);

    getLogger("message-router").debug("route", {
      sessionId: message.sessionId,
      messageId: message.id,
      role: message.role,
      handled,
    });

    return { handled, sessionId: message.sessionId, message };
  }

  registerHandler(role: MessageRole, handler: MessageHandler): void {
    this.handlers.set(role, handler);
  }

  unregisterHandler(role: MessageRole): void {
    this.handlers.delete(role);
  }

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

  dispose(): void {
    this.history.clear();
    this.handlers.clear();
  }
}
