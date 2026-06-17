// ============================================================================
// PromptBuilder unit tests
//
// refs: docs/mesh-prompt-injection-design.md Section 11.1
// ============================================================================

import * as assert from "assert";
import {
  buildMeshSystemPrompt,
  buildPlannerSystemPrompt,
  buildWorkerSystemPrompt,
  buildLeadSystemPrompt,
  buildReviewerSystemPrompt,
  buildUserPromptEnvelope,
  buildReinjectionPrompt,
  buildRepromptMessage,
  PromptBuilder,
  type MeshProtocolConfig,
  type InboundMessage,
} from "../../domain/services/prompt-builder";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function baseConfig(
  overrides: Partial<MeshProtocolConfig> = {}
): MeshProtocolConfig {
  return {
    enabled: true,
    version: "2",
    role: "worker",
    agentId: "test-agent",
    ...overrides,
  };
}

const SAMPLE_INBOUND: InboundMessage = {
  type: "task_request",
  from: "planner",
  id: "msg-123",
  payload: {
    taskId: "step-1",
    planId: "plan-456",
    description: "Implement OAuth2 token refresh",
    priority: "normal",
    requireResponse: true,
  },
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("prompt-builder", () => {
  // -----------------------------------------------------------------------
  // buildMeshSystemPrompt
  // -----------------------------------------------------------------------

  describe("buildMeshSystemPrompt", () => {
    it("should return empty string when disabled", () => {
      const config = baseConfig({ enabled: false });
      assert.strictEqual(buildMeshSystemPrompt(config), "");
    });

    it("should include protocol version", () => {
      const config = baseConfig({ version: "2" });
      const prompt = buildMeshSystemPrompt(config);
      assert.ok(prompt.includes("Mesh Protocol v2"));
    });

    it("should include role in uppercase", () => {
      const config = baseConfig({ role: "planner" });
      const prompt = buildMeshSystemPrompt(config);
      assert.ok(prompt.includes("PLANNER"));
    });

    it("should include team info when teamId is set", () => {
      const config = baseConfig({
        teamId: "team-alpha",
        teamName: "Alpha Team",
      });
      const prompt = buildMeshSystemPrompt(config);
      assert.ok(prompt.includes("team-alpha"));
      assert.ok(prompt.includes("Alpha Team"));
    });

    it("should include team members when memberAgents is set", () => {
      const config = baseConfig({
        teamId: "team-alpha",
        memberAgents: ["agent-1", "agent-2"],
      });
      const prompt = buildMeshSystemPrompt(config);
      assert.ok(prompt.includes("agent-1"));
      assert.ok(prompt.includes("agent-2"));
    });

    it("should include marker format example", () => {
      const config = baseConfig();
      const prompt = buildMeshSystemPrompt(config);
      assert.ok(prompt.includes("[ACP_MESH_MESSAGE v2]"));
      assert.ok(prompt.includes("[/ACP_MESH_MESSAGE]"));
    });

    it("should include v1 format when version is 1", () => {
      const config = baseConfig({ version: "1" });
      const prompt = buildMeshSystemPrompt(config);
      assert.ok(prompt.includes("Mesh Protocol v1"));
      assert.ok(prompt.includes("[ACP_MESH_MESSAGE v1]"));
    });

    it("should not include team section when teamId is absent", () => {
      const config = baseConfig();
      const prompt = buildMeshSystemPrompt(config);
      assert.ok(!prompt.includes("team"));
    });
  });

  // -----------------------------------------------------------------------
  // Role-specific system prompts
  // -----------------------------------------------------------------------

  describe("buildPlannerSystemPrompt", () => {
    it("should include PLANNER role heading", () => {
      const prompt = buildPlannerSystemPrompt();
      assert.ok(prompt.includes("PLANNER"));
    });

    it("should include plan_proposal marker example", () => {
      const prompt = buildPlannerSystemPrompt();
      assert.ok(prompt.includes("plan_proposal"));
    });

    it("should include task_request marker example", () => {
      const prompt = buildPlannerSystemPrompt();
      assert.ok(prompt.includes("task_request"));
    });

    it("should include dependsOn in plan step example", () => {
      const prompt = buildPlannerSystemPrompt();
      assert.ok(prompt.includes("dependsOn"));
    });

    it("should include rules section", () => {
      const prompt = buildPlannerSystemPrompt();
      assert.ok(prompt.includes("Rules:"));
    });
  });

  describe("buildWorkerSystemPrompt", () => {
    it("should include WORKER role heading", () => {
      const prompt = buildWorkerSystemPrompt();
      assert.ok(prompt.includes("WORKER"));
    });

    it("should include task_response marker example", () => {
      const prompt = buildWorkerSystemPrompt();
      assert.ok(prompt.includes("task_response"));
    });

    it("should include filesModified field", () => {
      const prompt = buildWorkerSystemPrompt();
      assert.ok(prompt.includes("filesModified"));
    });

    it("should include replyTo in metadata example", () => {
      const prompt = buildWorkerSystemPrompt();
      assert.ok(prompt.includes("replyTo"));
    });
  });

  describe("buildLeadSystemPrompt", () => {
    it("should include LEAD role heading", () => {
      const prompt = buildLeadSystemPrompt();
      assert.ok(prompt.includes("LEAD"));
    });

    it("should include task_plan marker example", () => {
      const prompt = buildLeadSystemPrompt();
      assert.ok(prompt.includes("task_plan"));
    });

    it("should include subtasks array example", () => {
      const prompt = buildLeadSystemPrompt();
      assert.ok(prompt.includes("subtasks"));
    });

    it("should include complexity field", () => {
      const prompt = buildLeadSystemPrompt();
      assert.ok(prompt.includes("complexity"));
    });
  });

  describe("buildReviewerSystemPrompt", () => {
    it("should include REVIEWER role heading", () => {
      const prompt = buildReviewerSystemPrompt();
      assert.ok(prompt.includes("REVIEWER"));
    });

    it("should include review_response marker example", () => {
      const prompt = buildReviewerSystemPrompt();
      assert.ok(prompt.includes("review_response"));
    });

    it("should include issues array with severity levels", () => {
      const prompt = buildReviewerSystemPrompt();
      assert.ok(prompt.includes("issues"));
      assert.ok(prompt.includes("error"));
      assert.ok(prompt.includes("warning"));
      assert.ok(prompt.includes("info"));
    });

    it("should include passed field", () => {
      const prompt = buildReviewerSystemPrompt();
      assert.ok(prompt.includes("passed"));
    });
  });

  // -----------------------------------------------------------------------
  // buildUserPromptEnvelope
  // -----------------------------------------------------------------------

  describe("buildUserPromptEnvelope", () => {
    it("should include protocol header", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("Mesh Protocol Header"));
    });

    it("should include agent ID in header", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "my-agent",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("Agent ID: my-agent"));
    });

    it("should include role in header", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "agent-1",
        role: "planner",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("Role: planner"));
    });

    it("should include mode in header", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "agent-1",
        role: "worker",
        mode: "p2P",
      });
      assert.ok(prompt.includes("Mode: p2P"));
    });

    it("should include role-specific reminder", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("REMINDER:"));
      assert.ok(prompt.includes("task_response"));
    });

    it("should include the user task text", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Implement OAuth2 flow",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("Implement OAuth2 flow"));
    });

    it("should include inbound message context when provided", () => {
      const prompt = buildUserPromptEnvelope({
        text: "",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
        inboundMessage: SAMPLE_INBOUND,
      });
      assert.ok(prompt.includes("Incoming Message"));
      assert.ok(prompt.includes("task_request"));
      assert.ok(prompt.includes("planner"));
      assert.ok(prompt.includes("msg-123"));
    });

    it("should include replyTo instruction with inbound message ID", () => {
      const prompt = buildUserPromptEnvelope({
        text: "",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
        inboundMessage: SAMPLE_INBOUND,
      });
      assert.ok(prompt.includes('"replyTo": "msg-123"'));
    });

    it("should include context files when provided", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
        contextFiles: ["src/auth/index.ts", "src/auth/oauth.ts"],
      });
      assert.ok(prompt.includes("Context Files"));
      assert.ok(prompt.includes("src/auth/index.ts"));
      assert.ok(prompt.includes("src/auth/oauth.ts"));
    });

    it("should not include context files section when empty", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(!prompt.includes("Context Files"));
    });

    it("should not include inbound section when no inbound message", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(!prompt.includes("Incoming Message"));
    });

    it("should include protocol version 2 in header", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("Protocol Version: 2"));
    });

    it("should include Your Task section", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Analyze the codebase",
        agentId: "agent-1",
        role: "planner",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("Your Task"));
      assert.ok(prompt.includes("Analyze the codebase"));
    });

    it("should format inbound payload as JSON", () => {
      const prompt = buildUserPromptEnvelope({
        text: "",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
        inboundMessage: SAMPLE_INBOUND,
      });
      assert.ok(prompt.includes('"taskId": "step-1"'));
      assert.ok(prompt.includes('"planId": "plan-456"'));
    });
  });

  // -----------------------------------------------------------------------
  // Role-specific reminders
  // -----------------------------------------------------------------------

  describe("role-specific reminders", () => {
    it("should remind planner to use plan_proposal and task_request", () => {
      const prompt = buildUserPromptEnvelope({
        text: "x",
        agentId: "a",
        role: "planner",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("plan_proposal"));
      assert.ok(prompt.includes("task_request"));
    });

    it("should remind worker to use task_response", () => {
      const prompt = buildUserPromptEnvelope({
        text: "x",
        agentId: "a",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("task_response"));
    });

    it("should remind lead to use task_plan", () => {
      const prompt = buildUserPromptEnvelope({
        text: "x",
        agentId: "a",
        role: "lead",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("task_plan"));
    });

    it("should remind reviewer to use review_response", () => {
      const prompt = buildUserPromptEnvelope({
        text: "x",
        agentId: "a",
        role: "reviewer",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("review_response"));
    });
  });

  // -----------------------------------------------------------------------
  // buildReinjectionPrompt
  // -----------------------------------------------------------------------

  describe("buildReinjectionPrompt", () => {
    it("should return empty string when disabled", () => {
      const config = baseConfig({ enabled: false });
      assert.strictEqual(buildReinjectionPrompt(config), "");
    });

    it("should include reinjection header", () => {
      const config = baseConfig();
      const prompt = buildReinjectionPrompt(config);
      assert.ok(prompt.includes("Mesh Protocol Reinjection"));
    });

    it("should mention context compression", () => {
      const config = baseConfig();
      const prompt = buildReinjectionPrompt(config);
      assert.ok(prompt.includes("context was compressed"));
    });

    it("should include agent ID and role", () => {
      const config = baseConfig({ agentId: "my-agent", role: "worker" });
      const prompt = buildReinjectionPrompt(config);
      assert.ok(prompt.includes("my-agent"));
      assert.ok(prompt.includes("worker"));
    });

    it("should include role reminder", () => {
      const config = baseConfig({ role: "worker" });
      const prompt = buildReinjectionPrompt(config);
      assert.ok(prompt.includes("task_response"));
    });

    it("should include marker format", () => {
      const config = baseConfig();
      const prompt = buildReinjectionPrompt(config);
      assert.ok(prompt.includes("[ACP_MESH_MESSAGE v2]"));
      assert.ok(prompt.includes("[/ACP_MESH_MESSAGE]"));
    });

    it("should include last inbound message when provided", () => {
      const config = baseConfig();
      const prompt = buildReinjectionPrompt(config, SAMPLE_INBOUND);
      assert.ok(prompt.includes("Last Incoming Message"));
      assert.ok(prompt.includes("task_request"));
      assert.ok(prompt.includes("planner"));
      assert.ok(prompt.includes("msg-123"));
    });

    it("should include replyTo instruction with last inbound ID", () => {
      const config = baseConfig();
      const prompt = buildReinjectionPrompt(config, SAMPLE_INBOUND);
      assert.ok(prompt.includes('"replyTo": "msg-123"'));
    });

    it("should not include last inbound section when not provided", () => {
      const config = baseConfig();
      const prompt = buildReinjectionPrompt(config);
      assert.ok(!prompt.includes("Last Incoming Message"));
    });

    it("should use correct version in marker format", () => {
      const config = baseConfig({ version: "1" });
      const prompt = buildReinjectionPrompt(config);
      assert.ok(prompt.includes("[ACP_MESH_MESSAGE v1]"));
    });
  });

  // -----------------------------------------------------------------------
  // buildRepromptMessage
  // -----------------------------------------------------------------------

  describe("buildRepromptMessage", () => {
    it("should include reminder header", () => {
      const msg = buildRepromptMessage("Do X", "some output", "task_response");
      assert.ok(msg.includes("Mesh Protocol Reminder"));
    });

    it("should reference the expected marker type", () => {
      const msg = buildRepromptMessage("Do X", "some output", "task_response");
      assert.ok(msg.includes("task_response"));
    });

    it("should include original task", () => {
      const msg = buildRepromptMessage(
        "Implement OAuth2",
        "some output",
        "task_response"
      );
      assert.ok(msg.includes("Implement OAuth2"));
    });

    it("should include agent output summary (truncated to 200 chars)", () => {
      const longOutput = "a".repeat(300);
      const msg = buildRepromptMessage("Do X", longOutput, "task_response");
      assert.ok(msg.includes("a".repeat(200)));
      assert.ok(!msg.includes("a".repeat(201)));
    });

    it("should include marker format reminder", () => {
      const msg = buildRepromptMessage("Do X", "output", "task_response");
      assert.ok(msg.includes("[ACP_MESH_MESSAGE v2]"));
      assert.ok(msg.includes("[/ACP_MESH_MESSAGE]"));
    });

    it("should instruct to include marker at END of response", () => {
      const msg = buildRepromptMessage("Do X", "output", "task_response");
      assert.ok(msg.includes("at the END of your response"));
    });

    it("should include expected marker type in format example", () => {
      const msg = buildRepromptMessage("Do X", "output", "plan_proposal");
      assert.ok(msg.includes('"type": "plan_proposal"'));
    });
  });

  // -----------------------------------------------------------------------
  // PromptBuilder class
  // -----------------------------------------------------------------------

  describe("PromptBuilder", () => {
    describe("constructor", () => {
      it("should accept a MeshProtocolConfig", () => {
        const config = baseConfig();
        const builder = new PromptBuilder(config);
        assert.ok(builder);
      });
    });

    describe("buildSystemPromptExtension", () => {
      it("should return empty string when disabled", () => {
        const config = baseConfig({ enabled: false });
        const builder = new PromptBuilder(config);
        assert.strictEqual(builder.buildSystemPromptExtension(), "");
      });

      it("should include common protocol section", () => {
        const config = baseConfig({ role: "worker" });
        const builder = new PromptBuilder(config);
        const ext = builder.buildSystemPromptExtension();
        assert.ok(ext.includes("Mesh Protocol v2"));
      });

      it("should include role-specific section for planner", () => {
        const config = baseConfig({ role: "planner" });
        const builder = new PromptBuilder(config);
        const ext = builder.buildSystemPromptExtension();
        assert.ok(ext.includes("PLANNER"));
        assert.ok(ext.includes("plan_proposal"));
      });

      it("should include role-specific section for worker", () => {
        const config = baseConfig({ role: "worker" });
        const builder = new PromptBuilder(config);
        const ext = builder.buildSystemPromptExtension();
        assert.ok(ext.includes("WORKER"));
        assert.ok(ext.includes("task_response"));
      });

      it("should include role-specific section for lead", () => {
        const config = baseConfig({ role: "lead" });
        const builder = new PromptBuilder(config);
        const ext = builder.buildSystemPromptExtension();
        assert.ok(ext.includes("LEAD"));
        assert.ok(ext.includes("task_plan"));
      });

      it("should include role-specific section for reviewer", () => {
        const config = baseConfig({ role: "reviewer" });
        const builder = new PromptBuilder(config);
        const ext = builder.buildSystemPromptExtension();
        assert.ok(ext.includes("REVIEWER"));
        assert.ok(ext.includes("review_response"));
      });
    });

    describe("buildUserPrompt", () => {
      it("should wrap text with protocol header", () => {
        const config = baseConfig({ agentId: "agent-1", role: "worker" });
        const builder = new PromptBuilder(config);
        const prompt = builder.buildUserPrompt({
          text: "Do something",
          mode: "supervisor",
        });
        assert.ok(prompt.includes("Mesh Protocol Header"));
        assert.ok(prompt.includes("Do something"));
      });

      it("should use config agentId in header", () => {
        const config = baseConfig({ agentId: "my-agent", role: "worker" });
        const builder = new PromptBuilder(config);
        const prompt = builder.buildUserPrompt({
          text: "x",
          mode: "supervisor",
        });
        assert.ok(prompt.includes("Agent ID: my-agent"));
      });

      it("should use config role in header", () => {
        const config = baseConfig({ agentId: "a", role: "planner" });
        const builder = new PromptBuilder(config);
        const prompt = builder.buildUserPrompt({
          text: "x",
          mode: "supervisor",
        });
        assert.ok(prompt.includes("Role: planner"));
      });

      it("should include inbound message when provided", () => {
        const config = baseConfig({ agentId: "a", role: "worker" });
        const builder = new PromptBuilder(config);
        const prompt = builder.buildUserPrompt({
          text: "",
          mode: "supervisor",
          inboundMessage: SAMPLE_INBOUND,
        });
        assert.ok(prompt.includes("Incoming Message"));
        assert.ok(prompt.includes("msg-123"));
      });

      it("should include context files when provided", () => {
        const config = baseConfig({ agentId: "a", role: "worker" });
        const builder = new PromptBuilder(config);
        const prompt = builder.buildUserPrompt({
          text: "x",
          mode: "supervisor",
          contextFiles: ["src/index.ts"],
        });
        assert.ok(prompt.includes("Context Files"));
        assert.ok(prompt.includes("src/index.ts"));
      });
    });

    describe("buildReinjection", () => {
      it("should return empty string when disabled", () => {
        const config = baseConfig({ enabled: false });
        const builder = new PromptBuilder(config);
        assert.strictEqual(builder.buildReinjection(), "");
      });

      it("should include reinjection prompt", () => {
        const config = baseConfig();
        const builder = new PromptBuilder(config);
        const prompt = builder.buildReinjection();
        assert.ok(prompt.includes("Mesh Protocol Reinjection"));
      });

      it("should include last inbound when provided", () => {
        const config = baseConfig();
        const builder = new PromptBuilder(config);
        const prompt = builder.buildReinjection(SAMPLE_INBOUND);
        assert.ok(prompt.includes("Last Incoming Message"));
        assert.ok(prompt.includes("msg-123"));
      });

      it("should not include last inbound when not provided", () => {
        const config = baseConfig();
        const builder = new PromptBuilder(config);
        const prompt = builder.buildReinjection();
        assert.ok(!prompt.includes("Last Incoming Message"));
      });
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle empty text in user prompt envelope", () => {
      const prompt = buildUserPromptEnvelope({
        text: "",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("Your Task"));
      assert.ok(prompt.includes("Mesh Protocol Header"));
    });

    it("should handle text with special characters", () => {
      const prompt = buildUserPromptEnvelope({
        text: 'Use `backticks` and "quotes" and $pecial ch@rs!',
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(prompt.includes("`backticks`"));
      assert.ok(prompt.includes('"quotes"'));
    });

    it("should handle very long text", () => {
      const longText = "x".repeat(10000);
      const prompt = buildUserPromptEnvelope({
        text: longText,
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
      });
      assert.ok(prompt.includes(longText));
    });

    it("should handle empty context files array", () => {
      const prompt = buildUserPromptEnvelope({
        text: "Do something",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
        contextFiles: [],
      });
      assert.ok(!prompt.includes("Context Files"));
    });

    it("should handle inbound message with empty payload", () => {
      const prompt = buildUserPromptEnvelope({
        text: "",
        agentId: "agent-1",
        role: "worker",
        mode: "supervisor",
        inboundMessage: { type: "ping", from: "a", id: "1", payload: {} },
      });
      assert.ok(prompt.includes("Incoming Message"));
      assert.ok(prompt.includes("ping"));
    });

    it("should handle all four roles in system prompt", () => {
      const roles = ["planner", "worker", "lead", "reviewer"] as const;
      for (const role of roles) {
        const config = baseConfig({ role });
        const prompt = buildMeshSystemPrompt(config);
        assert.ok(prompt.includes(role.toUpperCase()), `Missing role: ${role}`);
      }
    });
  });
});
