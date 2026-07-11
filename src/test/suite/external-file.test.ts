import * as assert from "assert";
import { describe, it } from "mocha";
import { collectExternalFileAttachments } from "../../adapter/context/externalFile";
import type { ContextAttachmentDTO } from "../../domain/models/chat";

describe("collectExternalFileAttachments", () => {
  const makeAttachment = (path: string): ContextAttachmentDTO => ({
    id: `id-${path}`,
    type: "file",
    path,
    label: path.split("/").pop() ?? path,
    tokenCount: 1,
    content: "content",
  });

  it("resolves each selected URI into an attachment", async () => {
    const resolveFile = async (p: string) => makeAttachment(p);
    const uris = [{ fsPath: "/tmp/a.txt" }, { fsPath: "/tmp/b.txt" }];
    const result = await collectExternalFileAttachments(uris, resolveFile);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].path, "/tmp/a.txt");
    assert.strictEqual(result[1].path, "/tmp/b.txt");
  });

  it("skips files that fail to resolve without aborting the batch", async () => {
    const resolveFile = async (p: string): Promise<ContextAttachmentDTO> => {
      if (p.includes("bad")) throw new Error("unreadable");
      return makeAttachment(p);
    };
    const uris = [{ fsPath: "/tmp/bad.txt" }, { fsPath: "/tmp/ok.txt" }];
    const result = await collectExternalFileAttachments(uris, resolveFile);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, "/tmp/ok.txt");
  });

  it("returns an empty array when no URIs are selected", async () => {
    const resolveFile = async (p: string) => makeAttachment(p);
    const result = await collectExternalFileAttachments([], resolveFile);
    assert.strictEqual(result.length, 0);
  });

  it("forwards absolute paths from outside the workspace", async () => {
    const resolveFile = async (p: string) => makeAttachment(p);
    const uris = [{ fsPath: "/Users/me/secret/config.json" }];
    const result = await collectExternalFileAttachments(uris, resolveFile);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, "/Users/me/secret/config.json");
  });
});
