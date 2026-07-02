import { strict as assert } from "assert";
import { NdjsonParser, serializeMessage, parseLine } from "../../adapter/acp/framing";

describe("serializeMessage", () => {
  it("serializes a JSON-RPC message with newline terminator", () => {
    const msg = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    const result = serializeMessage(msg);
    assert.strictEqual(
      result,
      JSON.stringify(msg) + "\n"
    );
  });

  it("accepts objects with newline-escaped strings (JSON.stringify handles escaping)", () => {
    // JSON.stringify escapes newlines in string values to \\n,
    // so serialized output contains no literal newlines.
    // The embedded-newline guard in serializeMessage is a belt-and-suspenders
    // safety net for non-standard inputs, not reachable via normal objects.
    const msg = { bad: "line1\nline2" };
    const result = serializeMessage(msg);
    // No throw expected — JSON.stringify produces escaped output
    assert.ok(result.endsWith("\n"));
  });

  it("handles nested objects correctly", () => {
    const msg = {
      jsonrpc: "2.0",
      method: "session/prompt",
      params: { sessionId: "abc", messages: [{ role: "user", content: "hello" }] },
    };
    const result = serializeMessage(msg);
    const parsed = JSON.parse(result.trim());
    assert.deepStrictEqual(parsed, msg);
  });
});

describe("parseLine", () => {
  it("parses valid JSON line", () => {
    const line = JSON.stringify({ jsonrpc: "2.0", result: "ok" });
    const result = parseLine(line);
    assert.deepStrictEqual(result, { jsonrpc: "2.0", result: "ok" });
  });

  it("returns null for invalid JSON", () => {
    assert.strictEqual(parseLine("not json"), null);
  });

  it("returns null for empty string", () => {
    assert.strictEqual(parseLine(""), null);
  });
});

describe("NdjsonParser", () => {
  it("parses a single complete line", () => {
    const parser = new NdjsonParser();
    const lines: string[] = [];
    parser.feed('{"a":1}\n', (line) => lines.push(line));
    assert.deepStrictEqual(lines, ['{"a":1}']);
    assert.strictEqual(parser.pendingLength, 0);
  });

  it("handles multiple lines in one chunk", () => {
    const parser = new NdjsonParser();
    const lines: string[] = [];
    parser.feed('{"a":1}\n{"b":2}\n{"c":3}\n', (line) => lines.push(line));
    assert.deepStrictEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("buffers partial lines across chunks", () => {
    const parser = new NdjsonParser();
    const lines: string[] = [];
    const onLine = (line: string) => lines.push(line);

    // split first line into two chunks
    parser.feed('{"a":', onLine);
    assert.strictEqual(lines.length, 0);
    assert.strictEqual(parser.pendingLength, 5);

    parser.feed('1}\n', onLine);
    assert.strictEqual(lines.length, 1);
    assert.deepStrictEqual(lines, ['{"a":1}']);
    assert.strictEqual(parser.pendingLength, 0);
  });

  it("handles chunk ending with newline in the middle of the buffer", () => {
    const parser = new NdjsonParser();
    const lines: string[] = [];
    const onLine = (line: string) => lines.push(line);

    parser.feed('{"a":1}\n{"b":', onLine);
    assert.strictEqual(lines.length, 1);
    assert.deepStrictEqual(lines[0], '{"a":1}');
    assert.strictEqual(parser.pendingLength, 5);

    parser.feed('2}\n', onLine);
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(lines[1], '{"b":2}');
    assert.strictEqual(parser.pendingLength, 0);
  });

  it("ignores empty lines", () => {
    const parser = new NdjsonParser();
    const lines: string[] = [];
    parser.feed('\n\n{"a":1}\n\n', (line) => lines.push(line));
    assert.deepStrictEqual(lines, ['{"a":1}']);
  });

  it("handles stream of session/update notifications", () => {
    const parser = new NdjsonParser();
    const lines: string[] = [];
    const onLine = (line: string) => lines.push(line);

    // typical streaming scenario: multiple session/update notifications
    const msg1 = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { messagePartial: { role: "assistant", content: "Hello" } } } });
    const msg2 = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { messagePartial: { role: "assistant", content: "World" } } } });

    parser.feed(`${msg1}\n${msg2}\n`, onLine);
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(JSON.parse(lines[0]).params.update.messagePartial.content, "Hello");
    assert.deepStrictEqual(JSON.parse(lines[1]).params.update.messagePartial.content, "World");
  });

  it("reset clears internal buffer", () => {
    const parser = new NdjsonParser();
    const lines: string[] = [];
    parser.feed('{"a":', (line) => lines.push(line));
    assert.strictEqual(parser.pendingLength, 5);
    parser.reset();
    assert.strictEqual(parser.pendingLength, 0);
    assert.strictEqual(lines.length, 0);
  });

  it("flush returns remaining buffer contents", () => {
    const parser = new NdjsonParser();
    const lines: string[] = [];
    parser.feed('{"a":1}\n{"b":', (line) => lines.push(line));
    assert.strictEqual(lines.length, 1);

    const remaining = parser.flush();
    assert.strictEqual(remaining, '{"b":');
    assert.strictEqual(parser.pendingLength, 0);
  });

  it("flush returns empty when buffer is empty", () => {
    const parser = new NdjsonParser();
    assert.strictEqual(parser.flush(), "");
  });
});
