import { getLogger } from "../lib/logger";

const log = getLogger("messageRouter");

export type MessageHandler = (data: Record<string, unknown>) => void;

export class MessageRouter {
  private routes = new Map<string, MessageHandler>();

  /** Register a handler for a message type. Returns this for chaining. */
  register(
    type: string,
    handler: MessageHandler
  ): this {
    this.routes.set(type, handler);
    return this;
  }

  /** Register multiple handlers at once. */
  registerAll(handlers: Record<string, MessageHandler>): this {
    for (const [type, handler] of Object.entries(handlers)) {
      this.routes.set(type, handler);
    }
    return this;
  }

  /** Dispatch a message to the registered handler. */
  handle(data: { type: string } & Record<string, unknown>): void {
    const handler = this.routes.get(data.type);
    if (!handler) {
      log.warn("unhandled message type", { type: data.type });
      return;
    }
    handler(data);
  }

  /** Callback for window.addEventListener("message", ...). */
  onWindowMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: string } & Record<string, unknown>;
    if (!data?.type) return;
    log.debug("received", { type: data.type });
    this.handle(data as { type: string } & Record<string, unknown>);
  };
}
