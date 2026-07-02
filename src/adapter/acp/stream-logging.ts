import { ReadableStream, WritableStream, TransformStream } from "stream/web";

/**
 * TransformStream that wraps a stdout stream and logs traffic.
 *
 * Passes received data through without breaking NDJSON line boundaries,
 * while forwarding each line to the callback.
 */
export function createLoggingTransformStream(
  onLine: (line: string) => void
): TransformStream<Uint8Array, Uint8Array> {
  const textDecoder = new TextDecoder();
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Pass raw data through unchanged
      controller.enqueue(chunk);

      // Parse lines for logging
      buffer += textDecoder.decode(chunk, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          onLine(line);
        }
      }
    },
    flush() {
      // Flush any remaining buffer content
      if (buffer.length > 0) {
        onLine(buffer);
      }
    },
  });
}

/**
 * Wrap a WritableStream to log outgoing messages.
 *
 * Forwards each written line to the callback.
 */
export function wrapWritableWithLogging(
  target: WritableStream<Uint8Array>,
  onLine: (line: string) => void
): WritableStream<Uint8Array> {
  const textDecoder = new TextDecoder();
  let buffer = "";
  const writer = target.getWriter();

  return new WritableStream<Uint8Array>({
    async write(chunk) {
      await writer.write(chunk);

      // Parse lines for logging
      buffer += textDecoder.decode(chunk, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          onLine(line);
        }
      }
    },
    async close() {
      if (buffer.length > 0) {
        onLine(buffer);
      }
      writer.releaseLock();
      await target.close();
    },
    async abort(reason) {
      writer.releaseLock();
      await target.abort(reason);
    },
  });
}
