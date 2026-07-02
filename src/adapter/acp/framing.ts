/**
 * NDJSON (Newline-Delimited JSON) framing utilities
 *
 * The ACP transport layer uses newline-delimited JSON.
 * Each JSON-RPC message is a single-line JSON object separated by `\n`.
 * Messages MUST NOT contain embedded newlines.
 *
 * Both goose (aaif-goose/goose) and gemini-cli (google-gemini/gemini-cli)
 * delegate NDJSON handling to the official `@agentclientprotocol/sdk`'s
 * `ndJsonStream` function rather than implementing their own framing layer.
 *
 * @see https://agentclientprotocol.com/protocol/transports
 * @see http://ndjson.org/
 */

/**
 * Serialize a JSON-RPC message to an NDJSON line.
 * Returns a string in `{...json...}\n` format.
 *
 * @throws {Error} if the serialized result contains an embedded newline
 */
export function serializeMessage(message: unknown): string {
  const json = JSON.stringify(message);
  if (json.includes("\n")) {
    throw new Error(
      "NDJSON framing error: serialized message contains embedded newline. " +
        "ACP protocol requires messages to be single-line JSON."
    );
  }
  return json + "\n";
}

/**
 * Parse a JSON line into an object.
 *
 * @returns parsed result, or null on failure
 */
export function parseLine(line: string): unknown | null {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

/**
 * NDJSON stream parser.
 *
 * Buffers incomplete lines (data where the newline hasn't arrived yet)
 * and invokes the callback once a complete line is available.
 *
 * Usage:
 * ```typescript
 * const parser = new NdjsonParser();
 * agent.stdout.on("data", (chunk: Buffer) => {
 *   parser.feed(chunk.toString("utf8"), (line) => {
 *     const msg = parseLine(line);
 *     if (msg) handleMessage(msg);
 *   });
 * });
 * ```
 */
export class NdjsonParser {
  private buffer = "";

  /**
   * Feed a received text chunk and pass complete lines to the callback.
   *
   * @param chunk received text chunk (UTF-8 string)
   * @param onLine callback receiving a complete line; empty lines are skipped
   */
  feed(chunk: string, onLine: (line: string) => void): void {
    this.buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        onLine(line);
      }
    }
  }

  /**
   * Flush any unprocessed data remaining in the buffer.
   * Covers trailing data without a terminating newline.
   *
   * @returns remaining buffer content, or empty string if nothing is pending
   */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining;
  }

  /**
   * Clear the internal buffer.
   */
  reset(): void {
    this.buffer = "";
  }

  /**
   * Return the length of unprocessed data currently held in the buffer.
   */
  get pendingLength(): number {
    return this.buffer.length;
  }
}
