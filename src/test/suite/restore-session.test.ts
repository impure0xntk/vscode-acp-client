import * as assert from "assert";
import { describe, it, beforeEach, afterEach } from "mocha";
import { EventEmitter } from "events";

import type { AppSessionInfo } from "../../application/session/types";
import type { ChatMessage } from "../../domain/models/chat";
import type { AgentInfo } from "../../application/session/orchestrator";
import type { UIAPI } from "../../platform/ui";
import type { FileSystemAPI } from "../../platform/filesystem";

// ============================================================================
// Minimal mock factories
// ============================================================================

function makeUI(): UIAPI {
  return {
    showMessage: async () => {},
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    showOpenDialog: async () => undefined,
    createOutputChannel: () => ({
      appendLine() {},
      show() {},
      dispose() {},
    }),
    createWebviewPanel: () => ({
      webview: {
        html: "",
        postMessage: async () => true,
        onDidReceiveMessage: () => ({ dispose() {} }),
        asWebviewUri: (u: any) => u,
        cspSource: "",
      },
      reveal() {},
      onDidDispose: () => ({ dispose() {} }),
      dispose() {},
    }),
    registerTreeDataProvider: () => ({ dispose() {} }),
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async () => undefined,
    setContext: async () => {},
    createEventEmitter: () => ({
      event: (_listener: any) => ({ dispose() {} }),
      fire(_data: any) {},
      dispose() {},
    }),
    showNotification: async () => undefined,
    clipboardWriteText: async () => {},
    getConfiguration: <T>(_section: string, _key: string, defaultValue: T) => defaultValue,
  } as unknown as UIAPI;
}

function makeFS(): FileSystemAPI {
  return {
    readFile: async () => "",
    writeFile: async () => {},
    fileExists: async () => false,
    stat: async () => ({ type: "file", mtime: 0, size: 0 }),
    findFiles: async () => [],
    findFilesInDirectory: async () => [],
    watchFiles: () => () => {},
    captureSnapshot: async () => ({ path: "", content: "", mtime: 0 }),
    uri: (p: string) =>
      ({ scheme: "file", fsPath: p, path: p, toString: () => p }) as any,
    joinPath: (base: any, ...segs: string[]) =>
      ({
        scheme: "file",
        fsPath: base.fsPath + "/" + segs.join("/"),
        path: base.path + "/" + segs.join("/"),
        toString: () => base.path + "/" + segs.join("/"),
      }) as any,
    basename: (p: string) => p.split("/").pop() || "",
    dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
    relativePath: (_from: string, to: string) => to,
    isAbsolutePath: (p: string) => p.startsWith("/"),
    getConfiguration: () => ({ get: (_k: string, d?: any) => d }),
    get workspaceRoots() {
      return ["/workspace"];
    },
    get workspaceRoot() {
      return "/workspace";
    },
    resolvePath: (base: string, rel: string) => base + "/" + rel,
  } as unknown as FileSystemAPI;
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 10)}`,
    role: "user",
    content: "Hello",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// Access private members via index-signature cast
// ============================================================================

interface OrchestratorInternals {
  connections: Map<string, any>;
  sessions: Map<string, Map<string, AppSessionInfo>>;
  activeSessions: Map<string, string>;
  agentInfoMap: Map<string, AgentInfo>;
  agentConfigs: Map<string, any>;
  historyStore: any;
  getSessionInfo(
    agentId: string,
    sessionId: string
  ): AppSessionInfo | undefined;
  prompt(
    agentId: string,
    sessionId: string,
    text: string,
    context?: any
  ): Promise<void>;
  restoreSession(
    agentId: string,
    sourceSessionId: string,
    messages: ChatMessage[]
  ): Promise<any>;
  chatMessageToContentBlocks(msg: ChatMessage): any[];
}

function orchAs(o: any): OrchestratorInternals {
  return o as unknown as OrchestratorInternals;
}

// ============================================================================
// Tests
// ============================================================================

describe("restoreSession — Strategy 1: native loadSession", () => {
  let orchestrator: any;
  let mockConn: any;

  beforeEach(() => {
    // Lazy import to avoid side effects at module level
    const {
      SessionOrchestrator,
    } = require("../../application/session/orchestrator");
    orchestrator = new SessionOrchestrator({ ui: makeUI(), fs: makeFS() });
    const o = orchAs(orchestrator);

    // Mock connection with loadSession support
    mockConn = {
      loadSession: async (req: any) => {
        // Agent returns no sessionId (per ACP spec)
      },
      newSession: async (_req: any) => ({ sessionId: "should-not-be-called" }),
      prompt: async (_req: any) => ({ stopReason: "end_turn" }),
    };
    o.connections.set("agent-native", mockConn);

    // Register agent info with loadSession capability
    o.agentInfoMap.set("agent-native", {
      name: "Native Agent",
      protocolVersion: 1,
      capabilities: { loadSession: true },
    });

    // Pre-register a source session so getSessionInfo finds it
    const sourceSession: AppSessionInfo = {
      sessionId: "sess-source-001",
      agentId: "agent-native",
      title: "Original Session",
      cwd: "/workspace/project",
      status: "idle",
      lastTurnOutcome: null,
      messages: [],
      isStreaming: false,
      tokenUsage: { input: 500, output: 200, total: 700 },
      createdAt: new Date(),
      updatedAt: new Date(),
      lastResponseAt: null,
      pendingCancel: false,
    };
    o.sessions.set(
      "agent-native",
      new Map([["sess-source-001", sourceSession]])
    );
  });

  afterEach(() => {
    orchestrator.dispose();
  });

  it("calls connection.loadSession with the source sessionId", async () => {
    let capturedReq: any = null;
    mockConn.loadSession = async (req: any) => {
      capturedReq = req;
    };

    const messages = [makeMessage({ role: "user", content: "Hi" })];
    await orchestrator.restoreSession(
      "agent-native",
      "sess-source-001",
      messages
    );

    assert.ok(capturedReq, "loadSession should have been called");
    assert.strictEqual(capturedReq.sessionId, "sess-source-001");
    assert.strictEqual(capturedReq.cwd, "/workspace/project");
  });

  it("returns nativeRestore=true and replayedMessageCount=0", async () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    const result = await orchestrator.restoreSession(
      "agent-native",
      "sess-source-001",
      messages
    );

    assert.strictEqual(result.nativeRestore, true);
    assert.strictEqual(result.replayedMessageCount, 0);
  });

  it("returns the same sessionId (not a new one)", async () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    const result = await orchestrator.restoreSession(
      "agent-native",
      "sess-source-001",
      messages
    );

    assert.strictEqual(result.sessionId, "sess-source-001");
  });

  it("registers the restored session in sessions map", async () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    await orchestrator.restoreSession(
      "agent-native",
      "sess-source-001",
      messages
    );

    const o = orchAs(orchestrator);
    const restored = o.getSessionInfo("agent-native", "sess-source-001");
    assert.ok(restored, "restored session should exist in sessions map");
    assert.strictEqual(restored!.sessionId, "sess-source-001");
    assert.strictEqual(restored!.title, "Original Session");
  });

  it("does NOT call connection.newSession or connection.prompt", async () => {
    let newSessionCalled = false;
    let promptCalled = false;
    mockConn.newSession = async () => {
      newSessionCalled = true;
      return { sessionId: "new" };
    };
    mockConn.prompt = async () => {
      promptCalled = true;
      return { stopReason: "end_turn" };
    };

    const messages = [makeMessage({ role: "user", content: "Hi" })];
    await orchestrator.restoreSession(
      "agent-native",
      "sess-source-001",
      messages
    );

    assert.strictEqual(
      newSessionCalled,
      false,
      "newSession should not be called in native path"
    );
    assert.strictEqual(
      promptCalled,
      false,
      "prompt should not be called in native path"
    );
  });

  it("uses process.cwd() when source session is not in sessions map", async () => {
    let capturedReq: any = null;
    mockConn.loadSession = async (req: any) => {
      capturedReq = req;
    };

    // Remove source session from map
    const o = orchAs(orchestrator);
    o.sessions.get("agent-native")!.delete("sess-source-001");

    const messages = [makeMessage({ role: "user", content: "Hi" })];
    await orchestrator.restoreSession(
      "agent-native",
      "sess-source-001",
      messages
    );

    assert.ok(capturedReq);
    assert.strictEqual(capturedReq.cwd, process.cwd());
  });
});

describe("restoreSession — Strategy 2: bridge replay", () => {
  let orchestrator: any;
  let mockConn: any;
  let promptCalls: Array<{ sessionId: string; text: string; context: any[] }>;

  beforeEach(() => {
    const {
      SessionOrchestrator,
    } = require("../../application/session/orchestrator");
    orchestrator = new SessionOrchestrator({ ui: makeUI(), fs: makeFS() });
    const o = orchAs(orchestrator);

    promptCalls = [];

    // Mock connection WITHOUT loadSession support
    mockConn = {
      loadSession: undefined, // agent does not support loadSession
      newSession: async (_req: any) => ({ sessionId: "sess-new-bridge" }),
      prompt: async (req: any) => {
        promptCalls.push({
          sessionId: req.sessionId,
          text: "",
          context: req.prompt,
        });
        return { stopReason: "end_turn" };
      },
    };
    o.connections.set("agent-bridge", mockConn);

    // Register agent info WITHOUT loadSession capability
    o.agentInfoMap.set("agent-bridge", {
      name: "Bridge Agent",
      protocolVersion: 1,
      capabilities: { loadSession: false },
    });

    // Pre-register source session
    const sourceSession: AppSessionInfo = {
      sessionId: "sess-source-002",
      agentId: "agent-bridge",
      title: "Bridge Original",
      cwd: "/workspace/bridge-proj",
      status: "idle",
      lastTurnOutcome: null,
      messages: [],
      isStreaming: false,
      tokenUsage: { input: 300, output: 100, total: 400 },
      createdAt: new Date(),
      updatedAt: new Date(),
      lastResponseAt: null,
      pendingCancel: false,
    };
    o.sessions.set(
      "agent-bridge",
      new Map([["sess-source-002", sourceSession]])
    );
  });

  afterEach(() => {
    orchestrator.dispose();
  });

  it("calls createSession (newSession) to get a new session ID", async () => {
    let newSessionCalled = false;
    mockConn.newSession = async () => {
      newSessionCalled = true;
      return { sessionId: "sess-new-bridge" };
    };

    const messages = [makeMessage({ role: "user", content: "Hi" })];
    await orchestrator.restoreSession(
      "agent-bridge",
      "sess-source-002",
      messages
    );

    assert.strictEqual(
      newSessionCalled,
      true,
      "newSession should be called in bridge path"
    );
  });

  it("returns nativeRestore=false and replayedMessageCount > 0", async () => {
    const messages = [
      makeMessage({ role: "user", content: "First" }),
      makeMessage({ role: "agent", content: "Reply" }),
      makeMessage({ role: "user", content: "Second" }),
    ];
    const result = await orchestrator.restoreSession(
      "agent-bridge",
      "sess-source-002",
      messages
    );

    assert.strictEqual(result.nativeRestore, false);
    // user + agent messages are replayed (3 total)
    assert.strictEqual(result.replayedMessageCount, 3);
  });

  it("returns a new session ID (not the source)", async () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    const result = await orchestrator.restoreSession(
      "agent-bridge",
      "sess-source-002",
      messages
    );

    assert.notStrictEqual(result.sessionId, "sess-source-002");
    assert.ok(result.sessionId.length > 0);
  });

  it("does NOT call connection.loadSession", async () => {
    let loadSessionCalled = false;
    mockConn.loadSession = async () => {
      loadSessionCalled = true;
    };

    const messages = [makeMessage({ role: "user", content: "Hi" })];
    await orchestrator.restoreSession(
      "agent-bridge",
      "sess-source-002",
      messages
    );

    assert.strictEqual(
      loadSessionCalled,
      false,
      "loadSession should not be called in bridge path"
    );
  });

  it("updates the new session title to match the source", async () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    const result = await orchestrator.restoreSession(
      "agent-bridge",
      "sess-source-002",
      messages
    );

    const o = orchAs(orchestrator);
    const newInfo = o.getSessionInfo("agent-bridge", result.sessionId);
    assert.ok(newInfo);
    assert.strictEqual(newInfo!.title, "Bridge Original");
  });
});

describe("replayMessages — message filtering", () => {
  let orchestrator: any;
  let mockConn: any;
  let promptCalls: Array<{ sessionId: string; context: any[] }>;

  beforeEach(() => {
    const {
      SessionOrchestrator,
    } = require("../../application/session/orchestrator");
    orchestrator = new SessionOrchestrator({ ui: makeUI(), fs: makeFS() });
    const o = orchAs(orchestrator);

    promptCalls = [];

    mockConn = {
      newSession: async (_req: any) => ({ sessionId: "sess-replay" }),
      prompt: async (req: any) => {
        promptCalls.push({ sessionId: req.sessionId, context: req.prompt });
        return { stopReason: "end_turn" };
      },
    };
    o.connections.set("agent-filter", mockConn);

    o.agentInfoMap.set("agent-filter", {
      name: "Filter Agent",
      protocolVersion: 1,
      capabilities: { loadSession: false },
    });

    const sourceSession: AppSessionInfo = {
      sessionId: "sess-source-filter",
      agentId: "agent-filter",
      title: "Filter Test",
      cwd: "/workspace/filter",
      status: "idle",
      lastTurnOutcome: null,
      messages: [],
      isStreaming: false,
      tokenUsage: { input: 0, output: 0, total: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
      lastResponseAt: null,
      pendingCancel: false,
    };
    o.sessions.set(
      "agent-filter",
      new Map([["sess-source-filter", sourceSession]])
    );
  });

  afterEach(() => {
    orchestrator.dispose();
  });

  it("replays user and agent messages, skipping tool/system", async () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "User msg 1" }),
      makeMessage({ id: "a1", role: "agent", content: "Agent reply" }),
      makeMessage({ id: "u2", role: "user", content: "User msg 2" }),
      makeMessage({ id: "t1", role: "tool", content: "" }),
      makeMessage({ id: "s1", role: "system", content: "System context" }),
      makeMessage({ id: "u3", role: "user", content: "User msg 3" }),
    ];

    const result = await orchestrator.restoreSession(
      "agent-filter",
      "sess-source-filter",
      messages
    );

    // u1, a1, u2, u3 = 4 replayable messages (tool + system skipped)
    assert.strictEqual(result.replayedMessageCount, 4);
    assert.strictEqual(promptCalls.length, 4);
    // In replay, prompt(agentId, sessionId, "", blocks) is called where blocks
    // comes from chatMessageToContentBlocks. prompt() builds:
    //   promptBlocks = [...blocks, { type: "text", text: "" }]
    // For a plain text "User msg 1", blocks = [{ type: "text", text: "User msg 1" }]
    // so the last non-empty text block in context equals the stored content.
    const textBlocks0 = promptCalls[0].context.filter(
      (b: any) => b.type === "text" && b.text
    );
    const textBlocks1 = promptCalls[1].context.filter(
      (b: any) => b.type === "text" && b.text
    );
    const textBlocks2 = promptCalls[2].context.filter(
      (b: any) => b.type === "text" && b.text
    );
    const textBlocks3 = promptCalls[3].context.filter(
      (b: any) => b.type === "text" && b.text
    );
    assert.strictEqual(textBlocks0[textBlocks0.length - 1].text, "User msg 1");
    assert.strictEqual(textBlocks1[textBlocks1.length - 1].text, "Agent reply");
    assert.strictEqual(textBlocks2[textBlocks2.length - 1].text, "User msg 2");
    assert.strictEqual(textBlocks3[textBlocks3.length - 1].text, "User msg 3");
  });

  it("returns 0 when there are no user or agent messages", async () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "t1", role: "tool", content: "" }),
      makeMessage({ id: "s1", role: "system", content: "System context" }),
    ];

    const result = await orchestrator.restoreSession(
      "agent-filter",
      "sess-source-filter",
      messages
    );

    assert.strictEqual(result.replayedMessageCount, 0);
    assert.strictEqual(promptCalls.length, 0);
  });

  it("emits sessionReplayStart, sessionReplayProgress, and sessionReplayComplete events", async () => {
    const events: string[] = [];
    orchestrator.on("sessionReplayStart", () => events.push("start"));
    orchestrator.on("sessionReplayProgress", () => events.push("progress"));
    orchestrator.on("sessionReplayComplete", () => events.push("complete"));

    const messages: ChatMessage[] = [
      makeMessage({ role: "user", content: "M1" }),
      makeMessage({ role: "agent", content: "A1" }),
      makeMessage({ role: "user", content: "M2" }),
    ];

    await orchestrator.restoreSession(
      "agent-filter",
      "sess-source-filter",
      messages
    );

    assert.ok(events.includes("start"), "should emit sessionReplayStart");
    assert.ok(events.includes("complete"), "should emit sessionReplayComplete");
    // progress fires once per replayable message (after each successful prompt)
    const progressCount = events.filter((e) => e === "progress").length;
    assert.strictEqual(progressCount, 3);
  });

  it("replays agent messages in order, preserving conversation flow", async () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "Question" }),
      makeMessage({ id: "a1", role: "agent", content: "Answer" }),
      makeMessage({ id: "u2", role: "user", content: "Follow-up" }),
      makeMessage({ id: "a2", role: "agent", content: "Detailed response" }),
    ];

    const result = await orchestrator.restoreSession(
      "agent-filter",
      "sess-source-filter",
      messages
    );

    assert.strictEqual(result.replayedMessageCount, 4);
    assert.strictEqual(promptCalls.length, 4);

    // Verify order is preserved
    const texts = promptCalls.map((c) => {
      const textBlocks = c.context.filter(
        (b: any) => b.type === "text" && b.text
      );
      return textBlocks[textBlocks.length - 1]?.text;
    });
    assert.deepStrictEqual(texts, [
      "Question",
      "Answer",
      "Follow-up",
      "Detailed response",
    ]);
  });

  it("continues replay even if one message fails", async () => {
    let callCount = 0;
    mockConn.prompt = async (_req: any) => {
      callCount++;
      if (callCount === 2) {
        throw new Error("agent error");
      }
      return { stopReason: "end_turn" };
    };

    const messages: ChatMessage[] = [
      makeMessage({ role: "user", content: "OK 1" }),
      makeMessage({ role: "user", content: "Will fail" }),
      makeMessage({ role: "user", content: "OK 3" }),
    ];

    const result = await orchestrator.restoreSession(
      "agent-filter",
      "sess-source-filter",
      messages
    );

    // 2 out of 3 succeed
    assert.strictEqual(result.replayedMessageCount, 2);
  });
});

describe("chatMessageToContentBlocks — ContentBlock conversion", () => {
  let orchestrator: any;

  beforeEach(() => {
    const {
      SessionOrchestrator,
    } = require("../../application/session/orchestrator");
    orchestrator = new SessionOrchestrator({ ui: makeUI(), fs: makeFS() });
  });

  afterEach(() => {
    orchestrator.dispose();
  });

  it("converts plain text message to a single text block", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "user",
      content: "Hello world",
      timestamp: 1000,
    };

    const blocks = orchAs(orchestrator).chatMessageToContentBlocks(msg);

    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, "text");
    assert.strictEqual((blocks[0] as any).text, "Hello world");
  });

  it("converts inlineFilePaths to resource_link blocks", () => {
    const msg: ChatMessage = {
      id: "m2",
      role: "user",
      content: "Check these",
      timestamp: 1000,
      inlineFilePaths: ["src/a.ts", "src/b.ts"],
    };

    const blocks = orchAs(orchestrator).chatMessageToContentBlocks(msg);

    // 2 resource_link + 1 text
    assert.strictEqual(blocks.length, 3);
    assert.strictEqual(blocks[0].type, "resource_link");
    assert.strictEqual((blocks[0] as any).uri, "src/a.ts");
    assert.strictEqual((blocks[0] as any).name, "src/a.ts");
    assert.strictEqual(blocks[1].type, "resource_link");
    assert.strictEqual((blocks[1] as any).uri, "src/b.ts");
    assert.strictEqual(blocks[2].type, "text");
    assert.strictEqual((blocks[2] as any).text, "Check these");
  });

  it("converts attachmentsJson to embedded resource blocks", () => {
    const msg: ChatMessage = {
      id: "m3",
      role: "user",
      content: "See attached",
      timestamp: 1000,
      attachmentsJson: JSON.stringify([
        { type: "file", path: "docs/readme.md", content: "# README" },
        { type: "selection", path: "src/main.ts", content: "const x = 1;" },
      ]),
    };

    const blocks = orchAs(orchestrator).chatMessageToContentBlocks(msg);

    // 2 resource + 1 text
    assert.strictEqual(blocks.length, 3);
    assert.strictEqual(blocks[0].type, "resource");
    assert.strictEqual((blocks[0] as any).resource.uri, "docs/readme.md");
    assert.strictEqual((blocks[0] as any).resource.text, "# README");
    assert.strictEqual(blocks[1].type, "resource");
    assert.strictEqual((blocks[1] as any).resource.uri, "src/main.ts");
    assert.strictEqual((blocks[1] as any).resource.text, "const x = 1;");
    assert.strictEqual(blocks[2].type, "text");
  });

  it("skips attachment types other than file/selection", () => {
    const msg: ChatMessage = {
      id: "m4",
      role: "user",
      content: "Mixed",
      timestamp: 1000,
      attachmentsJson: JSON.stringify([
        { type: "file", path: "a.ts", content: "code" },
        { type: "symbol", path: "b.ts", content: "should skip" },
        { type: "diff", path: "c.ts", content: "should skip" },
      ]),
    };

    const blocks = orchAs(orchestrator).chatMessageToContentBlocks(msg);

    // Only 1 resource (file) + 1 text
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, "resource");
    assert.strictEqual((blocks[0] as any).resource.uri, "a.ts");
  });

  it("handles malformed attachmentsJson gracefully", () => {
    const msg: ChatMessage = {
      id: "m5",
      role: "user",
      content: "Bad JSON",
      timestamp: 1000,
      attachmentsJson: "not valid json{{{",
    };

    const blocks = orchAs(orchestrator).chatMessageToContentBlocks(msg);

    // Should not throw, just skip attachments
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, "text");
  });

  it("handles empty content (no text block added)", () => {
    const msg: ChatMessage = {
      id: "m6",
      role: "user",
      content: "",
      timestamp: 1000,
      inlineFilePaths: ["src/only-file.ts"],
    };

    const blocks = orchAs(orchestrator).chatMessageToContentBlocks(msg);

    // Only resource_link, no text block
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, "resource_link");
  });

  it("handles message with no content and no attachments (empty blocks)", () => {
    const msg: ChatMessage = {
      id: "m7",
      role: "user",
      content: "",
      timestamp: 1000,
    };

    const blocks = orchAs(orchestrator).chatMessageToContentBlocks(msg);

    assert.strictEqual(blocks.length, 0);
  });

  it("orders blocks: resource_link first, then resource, then text", () => {
    const msg: ChatMessage = {
      id: "m8",
      role: "user",
      content: "Main text",
      timestamp: 1000,
      inlineFilePaths: ["file.ts"],
      attachmentsJson: JSON.stringify([
        { type: "file", path: "att.ts", content: "attached" },
      ]),
    };

    const blocks = orchAs(orchestrator).chatMessageToContentBlocks(msg);

    assert.strictEqual(blocks.length, 3);
    assert.strictEqual(blocks[0].type, "resource_link");
    assert.strictEqual(blocks[1].type, "resource");
    assert.strictEqual(blocks[2].type, "text");
  });
});

describe("restoreSession — error handling", () => {
  let orchestrator: any;

  beforeEach(() => {
    const {
      SessionOrchestrator,
    } = require("../../application/session/orchestrator");
    orchestrator = new SessionOrchestrator({ ui: makeUI(), fs: makeFS() });
  });

  afterEach(() => {
    orchestrator.dispose();
  });

  it("throws when agent is not connected", async () => {
    const messages = [makeMessage()];

    await assert.rejects(
      () =>
        orchestrator.restoreSession("nonexistent-agent", "sess-1", messages),
      /not connected/
    );
  });
});
