import * as assert from "assert";
import { describe, it, beforeEach, afterEach } from "mocha";
import { handleFixPrepare } from "../../webviewMessageHandler";
import type { ContextAttachment } from "../../types";

function makeAttachment(id: string): ContextAttachment {
  return {
    id,
    type: "selection",
    path: "/src/app.ts",
    label: "app.ts:1-5",
    lineRange: [1, 5],
    tokenCount: 12,
    content: "const x = 1;",
  };
}

describe("handleFixPrepare", () => {
  let dispatched: { type: string; detail: unknown } | null = null;
  let listeners: Record<string, Array<(e: unknown) => void>>;

  beforeEach(() => {
    dispatched = null;
    listeners = {};
    (global as unknown as { window: unknown }).window = {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener: () => {
        /* no-op for test */
      },
      dispatchEvent: (e: { type: string; detail: unknown }) => {
        dispatched = { type: e.type, detail: e.detail };
        return true;
      },
    };
    if (typeof (global as unknown as { CustomEvent?: unknown }).CustomEvent === "undefined") {
      (global as unknown as { CustomEvent: unknown }).CustomEvent = class<T> {
        type: string;
        detail: T;
        constructor(type: string, init?: { detail?: T }) {
          this.type = type;
          this.detail = (init?.detail as T) ?? (undefined as T);
        }
      };
    }
  });

  afterEach(() => {
    delete (global as unknown as { window?: unknown }).window;
  });

  it("dispatches acp:prepareReview with the attachment and prompt", () => {
    const attachment = makeAttachment("a1");
    handleFixPrepare({ type: "fix:prepare", attachment, prompt: "Fix this" });

    assert.ok(dispatched, "expected a window event to be dispatched");
    assert.strictEqual(dispatched!.type, "acp:prepareReview");
    const detail = dispatched!.detail as {
      attachment: ContextAttachment;
      prompt: string;
    };
    assert.strictEqual(detail.attachment.id, "a1");
    assert.strictEqual(detail.attachment.content, "const x = 1;");
    assert.strictEqual(detail.prompt, "Fix this");
  });

  it("is a no-op when the attachment is missing", () => {
    handleFixPrepare({
      type: "fix:prepare",
      attachment: undefined as unknown as ContextAttachment,
      prompt: "Fix this",
    });
    assert.strictEqual(dispatched, null);
  });
});
