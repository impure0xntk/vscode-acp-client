import { strict as assert } from "assert";
import { RequestError } from "@agentclientprotocol/sdk";
import {
  sessionNotFound,
  connectionFailed,
  initializeFailed,
  permissionDenied,
  toolExecutionFailed,
  isAcpError,
  toRequestError,
  type AcpError,
} from "../../adapter/acp/error";

describe("AcpError factories", () => {
  describe("sessionNotFound", () => {
    it("creates with sessionId in message and metadata", () => {
      const err = sessionNotFound("sess-abc");
      assert.strictEqual(err._tag, "ACP.SessionNotFound");
      assert.ok(err.message.includes("sess-abc"));
      assert.strictEqual(err.metadata?.sessionId, "sess-abc");
      assert.strictEqual(err.cause, undefined);
    });

    it("includes cause when provided", () => {
      const cause = new Error("underlying");
      const err = sessionNotFound("sess-xyz", cause);
      assert.strictEqual(err.cause, cause);
    });
  });

  describe("connectionFailed", () => {
    it("creates with agentId in message and metadata", () => {
      const err = connectionFailed("agent-1");
      assert.strictEqual(err._tag, "ACP.ConnectionFailed");
      assert.ok(err.message.includes("agent-1"));
      assert.strictEqual(err.metadata?.agentId, "agent-1");
    });

    it("includes cause", () => {
      const cause = new Error("spawn failed");
      const err = connectionFailed("agent-2", cause);
      assert.strictEqual(err.cause, cause);
    });
  });

  describe("initializeFailed", () => {
    it("creates without reason", () => {
      const err = initializeFailed("agent-1");
      assert.strictEqual(err._tag, "ACP.InitializeFailed");
      assert.ok(err.message.includes("agent-1"));
      assert.strictEqual(err.metadata?.agentId, "agent-1");
    });

    it("creates with reason", () => {
      const err = initializeFailed("agent-1", "timeout");
      assert.strictEqual(err._tag, "ACP.InitializeFailed");
      assert.ok(err.message.includes("timeout"));
      assert.strictEqual(err.metadata?.reason, "timeout");
    });
  });

  describe("permissionDenied", () => {
    it("creates with tool name and call id", () => {
      const err = permissionDenied("agent-1", "tc-123", "Edit");
      assert.strictEqual(err._tag, "ACP.PermissionDenied");
      assert.ok(err.message.includes("Edit"));
      assert.ok(err.message.includes("tc-123"));
      assert.strictEqual(err.metadata?.toolCallId, "tc-123");
      assert.strictEqual(err.metadata?.toolName, "Edit");
    });
  });

  describe("toolExecutionFailed", () => {
    it("creates with tool info", () => {
      const err = toolExecutionFailed("tc-456", "Bash");
      assert.strictEqual(err._tag, "ACP.ToolExecutionFailed");
      assert.ok(err.message.includes("Bash"));
      assert.ok(err.message.includes("tc-456"));
      assert.strictEqual(err.metadata?.toolCallId, "tc-456");
    });

    it("includes cause", () => {
      const cause = new Error("command failed");
      const err = toolExecutionFailed("tc-789", "Bash", cause);
      assert.strictEqual(err.cause, cause);
    });
  });
});

describe("isAcpError", () => {
  it("returns true for AcpError values", () => {
    const err = sessionNotFound("sess-1");
    assert.strictEqual(isAcpError(err), true);
  });

  it("returns true for all tag variants", () => {
    assert.strictEqual(isAcpError(connectionFailed("a")), true);
    assert.strictEqual(isAcpError(initializeFailed("a")), true);
    assert.strictEqual(isAcpError(permissionDenied("a", "t", "n")), true);
    assert.strictEqual(isAcpError(toolExecutionFailed("t", "n")), true);
  });

  it("returns false for null", () => {
    assert.strictEqual(isAcpError(null), false);
  });

  it("returns false for undefined", () => {
    assert.strictEqual(isAcpError(undefined), false);
  });

  it("returns false for plain Error", () => {
    assert.strictEqual(isAcpError(new Error("boo")), false);
  });

  it("returns false for plain object", () => {
    assert.strictEqual(isAcpError({ _tag: "not-acp" }), false);
  });

  it("returns false for string", () => {
    assert.strictEqual(isAcpError("error"), false);
  });

  it("returns false for object without _tag", () => {
    assert.strictEqual(isAcpError({ message: "oops" }), false);
  });
});

describe("toRequestError", () => {
  it("converts SessionNotFound to RequestError.internalError", () => {
    const acpErr = sessionNotFound("sess-abc");
    const reqErr = toRequestError(acpErr);
    assert.ok(reqErr instanceof RequestError);
  });

  it("converts ConnectionFailed to RequestError.internalError", () => {
    const reqErr = toRequestError(connectionFailed("a"));
    assert.ok(reqErr instanceof RequestError);
  });

  it("converts InitializeFailed to RequestError.internalError", () => {
    const reqErr = toRequestError(initializeFailed("a", "timeout"));
    assert.ok(reqErr instanceof RequestError);
  });

  it("converts PermissionDenied to RequestError.internalError", () => {
    const reqErr = toRequestError(permissionDenied("a", "t1", "bash"));
    assert.ok(reqErr instanceof RequestError);
  });

  it("converts ToolExecutionFailed to RequestError.internalError", () => {
    const reqErr = toRequestError(toolExecutionFailed("t2", "bash"));
    assert.ok(reqErr instanceof RequestError);
  });

  it("preserves message in RequestError", () => {
    const err = sessionNotFound("sess-xyz");
    const reqErr = toRequestError(err);
    assert.ok((reqErr as any).message?.includes("sess-xyz"));
  });
});
