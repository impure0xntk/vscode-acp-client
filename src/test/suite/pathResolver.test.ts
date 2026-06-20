import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";

// ============================================================================
// readTextFile error handling (PlatformAcpClient)
//
// readTextFile catches errors from deps.fs.readFile and returns { content: "" }
// instead of throwing an Internal error through the JSON-RPC layer.
// ============================================================================

// Mock vscode before importing the client — it imports vscode at module level
const Module = require("module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "vscode") {
    return "vscode-mock";
  }
  return originalResolveFilename.call(this, request, ...args);
};

require.cache["vscode-mock"] = {
  id: "vscode-mock",
  filename: "vscode-mock",
  loaded: true,
  exports: {
    workspace: {
      fs: {
        stat: async () => ({ type: 1, mtime: 0, size: 0 }),
        readFile: async () => new Uint8Array(),
        writeFile: async () => {},
      },
    },
    Uri: {
      file: (p: string) => ({ fsPath: p }),
    },
    window: {
      createOutputChannel: () => ({
        appendLine: () => {},
        show: () => {},
        dispose: () => {},
      }),
    },
    FileType: {
      File: 1,
      Directory: 2,
      SymbolicLink: 64,
    },
  },
} as unknown as NodeModule;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PlatformAcpClient } = require("../../adapter/acp/client");

function makeClient(readFileImpl: (p: string) => Promise<string>): any {
  const mockFs = { readFile: readFileImpl };
  const mockUi = {
    createOutputChannel: () => ({
      appendLine: () => {},
      show: () => {},
      dispose: () => {},
    }),
  };
  return new PlatformAcpClient(
    { fs: mockFs, ui: mockUi },
    () => {},
    async () => ({ outcome: "allow" })
  );
}

describe("readTextFile error handling", () => {
  it("returns content on successful read", async () => {
    const client = makeClient(async () => "hello world");
    const result = await client.readTextFile({ path: "/workspace/exists.ts" });
    assert.strictEqual(result.content, "hello world");
  });

  it("returns empty content when fs.readFile throws ENOENT", async () => {
    const client = makeClient(async () => {
      throw new Error("ENOENT: no such file or directory");
    });
    const result = await client.readTextFile({ path: "/workspace/missing.ts" });
    assert.strictEqual(result.content, "");
  });

  it("returns empty content when fs.readFile throws EACCES", async () => {
    const client = makeClient(async () => {
      throw new Error("EACCES: permission denied");
    });
    const result = await client.readTextFile({ path: "/secret.ts" });
    assert.strictEqual(result.content, "");
  });

  it("returns empty content for arbitrary errors without throwing", async () => {
    const client = makeClient(async () => {
      throw new Error("unexpected disk failure");
    });
    const result = await client.readTextFile({ path: "/any/path.ts" });
    assert.ok(result);
    assert.strictEqual(result.content, "");
  });

  it("passes the path through to fs.readFile", async () => {
    let receivedPath = "";
    const client = makeClient(async (p: string) => {
      receivedPath = p;
      return "ok";
    });
    await client.readTextFile({ path: "/workspace/src/index.ts" });
    assert.strictEqual(receivedPath, "/workspace/src/index.ts");
  });

  it("returns object with empty content (not undefined) on error", async () => {
    const client = makeClient(async () => {
      throw new Error("fail");
    });
    const result = await client.readTextFile({ path: "/x.ts" });
    assert.ok("content" in result);
    assert.strictEqual(result.content, "");
  });
});

// ============================================================================
// BatchedPathResolver — behaviour tests
//
// We test via the public API (enqueue / clear / updateCwd) and the timer-based
// flush.  The resolver uses vscode.workspace.fs.stat which is mocked above.
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BatchedPathResolver } = require("../../extension/pathResolver");

function createResolver(
  cwd: string,
  onResolved: (paths: string[]) => void
): any {
  return new BatchedPathResolver(cwd, { onResolved });
}

describe("BatchedPathResolver", () => {
  let resolvedPaths: string[];

  beforeEach(() => {
    resolvedPaths = [];
  });

  it("calls onResolved after enqueue + flush (timer)", async () => {
    const resolver = createResolver("/workspace", (paths) => {
      resolvedPaths.push(...paths);
    });
    resolver.enqueue(["src/index.ts"]);

    // Wait for the 100ms timer + flush
    await new Promise((r) => setTimeout(r, 200));

    assert.deepStrictEqual(resolvedPaths, ["src/index.ts"]);
    resolver.clear();
  });

  it("deduplicates: same path enqueued twice resolves once", async () => {
    const resolver = createResolver("/workspace", (paths) => {
      resolvedPaths.push(...paths);
    });
    resolver.enqueue(["a.ts", "a.ts"]);

    await new Promise((r) => setTimeout(r, 200));

    assert.deepStrictEqual(resolvedPaths, ["a.ts"]);
    resolver.clear();
  });

  it("clear() prevents pending flush from firing", async () => {
    const resolver = createResolver("/workspace", (paths) => {
      resolvedPaths.push(...paths);
    });
    resolver.enqueue(["a.ts"]);
    resolver.clear();

    // Wait longer than the flush timer
    await new Promise((r) => setTimeout(r, 200));

    assert.deepStrictEqual(resolvedPaths, []);
  });

  it("updateCwd clears resolved cache so paths are re-checked", async () => {
    const resolver = createResolver("/workspace", (paths) => {
      resolvedPaths.push(...paths);
    });

    // First batch
    resolver.enqueue(["a.ts"]);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepStrictEqual(resolvedPaths, ["a.ts"]);

    // Change cwd
    resolver.updateCwd("/other");
    resolvedPaths = [];

    // Re-enqueue same relative path — should resolve again under new cwd
    resolver.enqueue(["a.ts"]);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepStrictEqual(resolvedPaths, ["a.ts"]);

    resolver.clear();
  });

  it("enqueue with no new paths does not schedule extra flush", async () => {
    const resolver = createResolver("/workspace", (paths) => {
      resolvedPaths.push(...paths);
    });

    resolver.enqueue(["a.ts"]);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepStrictEqual(resolvedPaths, ["a.ts"]);

    // Re-enqueue same path — already resolved, should not trigger callback
    resolvedPaths = [];
    resolver.enqueue(["a.ts"]);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepStrictEqual(resolvedPaths, []);

    resolver.clear();
  });
});
