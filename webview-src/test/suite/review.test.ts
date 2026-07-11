import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useFileWriteStore } from "../../store/fileWriteStore";
import { buildReviewAttachment } from "../../lib/review";

describe("buildReviewAttachment", () => {
  beforeEach(() => {
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
  });

  it("returns null when the session has no writes", () => {
    const attachment = buildReviewAttachment("a1", "s1");
    assert.strictEqual(attachment, null);
  });

  it("aggregates multiple files into one diff attachment", () => {
    const store = useFileWriteStore.getState();
    store.addWrite("a1", "s1", "/src/foo.ts", "const a = 1;", "const a = 0;");
    store.addWrite("a1", "s1", "/src/bar.ts", "const b = 2;", "const b = 0;");
    const attachment = buildReviewAttachment("a1", "s1");
    assert.ok(attachment);
    assert.strictEqual(attachment!.type, "diff");
    assert.strictEqual(attachment!.path, "Files changed");
    assert.strictEqual(attachment!.label, "2 files changed");
    assert.ok(attachment!.content.includes("src/foo.ts"));
    assert.ok(attachment!.content.includes("src/bar.ts"));
    assert.ok(attachment!.tokenCount > 0);
  });

  it("collapses repeated writes to the same path (first original → last content)", () => {
    const store = useFileWriteStore.getState();
    store.addWrite("a1", "s1", "/src/foo.ts", "v2", "v0");
    store.addWrite("a1", "s1", "/src/foo.ts", "v3", "v2");
    const attachment = buildReviewAttachment("a1", "s1");
    assert.ok(attachment);
    assert.strictEqual(attachment!.label, "1 file changed");
    // Diff should reflect original v0 → final v3 and skip the intermediate v2.
    assert.ok(attachment!.content.includes("-v0"));
    assert.ok(attachment!.content.includes("+v3"));
    assert.ok(!attachment!.content.includes("+v2"));
  });

  it("renders a newly created file as pure additions", () => {
    const store = useFileWriteStore.getState();
    store.addWrite("a1", "s1", "/src/new.ts", "line1\nline2\n");
    const attachment = buildReviewAttachment("a1", "s1");
    assert.ok(attachment);
    assert.ok(attachment!.content.includes("+line1"));
  });

  it("scopes writes per session", () => {
    const store = useFileWriteStore.getState();
    store.addWrite("a1", "s1", "/src/foo.ts", "x", "y");
    store.addWrite("a1", "s2", "/src/foo.ts", "p", "q");
    const s1 = buildReviewAttachment("a1", "s1");
    const s2 = buildReviewAttachment("a1", "s2");
    assert.ok(s1 && s2);
    assert.strictEqual(s1!.label, "1 file changed");
    assert.strictEqual(s2!.label, "1 file changed");
    assert.ok(s1!.content.includes("-y"));
    assert.ok(s2!.content.includes("-q"));
  });
});
