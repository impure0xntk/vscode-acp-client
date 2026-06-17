// ============================================================================
// PromptBuilder — Mesh Protocol prompt injection service
//
// Generates system prompt extensions and user prompt envelopes that teach
// agents how to emit [ACP_MESH_MESSAGE] markers for P2P communication.
//
// refs: docs/mesh-prompt-injection-design.md Section 3, 4, 5
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type MeshAgentRole = "planner" | "worker" | "lead" | "reviewer";

export interface MeshProtocolConfig {
  enabled: boolean;
  version: "1" | "2";
  role: MeshAgentRole;
  agentId: string;
  teamId?: string;
  teamName?: string;
  memberAgents?: string[];
}

export interface InboundMessage {
  type: string;
  from: string;
  id: string;
  payload: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// System Prompt — common protocol section
// ----------------------------------------------------------------------------

/**
 * Generate the common Mesh Protocol system prompt section.
 * Inserted once at agent startup.
 */
export function buildMeshSystemPrompt(config: MeshProtocolConfig): string {
  if (!config.enabled) return "";

  const members = config.memberAgents?.length
    ? `\nTeam members: ${config.memberAgents.join(", ")}`
    : "";

  const team = config.teamId
    ? `\nYou are part of team "${config.teamName ?? config.teamId}" (ID: ${config.teamId}).${members}`
    : "";

  return `
---
## Mesh Protocol v${config.version}

You are a **${config.role.toUpperCase()}** agent in a multi-agent mesh system.${team}

### Communication Protocol

When you need to communicate with other agents, use the following **Mesh Marker** format.
The orchestrator will extract these markers from your output and route them to the target agent.

**IMPORTANT**: The marker content MUST be valid JSON. Do NOT include any text inside the marker delimiters other than the JSON.

**Format (v${config.version}):**

\`\`\`
[ACP_MESH_MESSAGE v${config.version}]
{
  "version": "${config.version}.0",
  "type": "<message_type>",
  "id": "<generate a UUID>",
  "from": "<your agent ID>",
  "to": "<target agent ID or 'broadcast'>",
  "mode": "<supervisor | p2P>",
  "payload": { ... },
  "metadata": { "replyTo": "<optional: ID of message you are replying to>" }
}
[/ACP_MESH_MESSAGE]
\`\`\`
`;
}

// ----------------------------------------------------------------------------
// Role-specific system prompt sections
// ----------------------------------------------------------------------------

export function buildPlannerSystemPrompt(): string {
  return `
### Your Role: PLANNER

You are responsible for **planning and coordinating** complex tasks.

**When given a task:**
1. Analyze the task and break it into logical steps
2. Create an execution plan using the \`plan_proposal\` marker type
3. Delegate each step to appropriate worker agents using \`task_request\` markers
4. Aggregate results from workers and provide a final summary

**Plan Proposal format:**

\`\`\`
[ACP_MESH_MESSAGE v2]
{
  "version": "2.0",
  "type": "plan_proposal",
  "id": "<uuid>",
  "from": "<your agent ID>",
  "to": "orchestrator",
  "mode": "supervisor",
  "payload": {
    "planId": "<uuid>",
    "title": "<plan title>",
    "steps": [
      { "id": "step-1", "description": "<step description>", "assignedTo": "<worker agent ID>", "dependsOn": [] },
      { "id": "step-2", "description": "<step description>", "assignedTo": "<worker agent ID>", "dependsOn": ["step-1"] }
    ]
  }
}
[/ACP_MESH_MESSAGE]
\`\`\`

**Task Request format:**

\`\`\`
[ACP_MESH_MESSAGE v2]
{
  "version": "2.0",
  "type": "task_request",
  "id": "<uuid>",
  "from": "<your agent ID>",
  "to": "<worker agent ID>",
  "mode": "supervisor",
  "payload": {
    "taskId": "<step ID>",
    "planId": "<plan ID>",
    "description": "<task description>",
    "priority": "normal",
    "requireResponse": true
  }
}
[/ACP_MESH_MESSAGE]
\`\`\`

**Rules:**
- Always output a \`plan_proposal\` BEFORE sending task requests
- Keep each step focused and independently executable
- Specify dependencies explicitly with \`dependsOn\`
- After all workers complete, send a \`status_update\` with status "completed"

`;
}

export function buildWorkerSystemPrompt(): string {
  return `
### Your Role: WORKER

You are responsible for **executing specific tasks** assigned by a planner or lead agent.

**When you receive a task:**
1. Analyze the task requirements
2. Execute the task to the best of your ability
3. Report your results using the \`task_response\` marker type

**Task Response format:**

\`\`\`
[ACP_MESH_MESSAGE v2]
{
  "version": "2.0",
  "type": "task_response",
  "id": "<uuid>",
  "from": "<your agent ID>",
  "to": "<sender agent ID>",
  "mode": "supervisor",
  "payload": {
    "taskId": "<the task ID from the task_request>",
    "planId": "<plan ID if provided>",
    "status": "completed | failed | partial",
    "result": "<description of what you did / output>",
    "filesModified": ["<list of files you changed>"]
  },
  "metadata": {
    "replyTo": "<id of the task_request message>"
  }
}
[/ACP_MESH_MESSAGE]
\`\`\`

**Rules:**
- Always respond to \`task_request\` messages with a \`task_response\`
- Report failures honestly with error details
- List all files you modified in \`filesModified\`
- If you need to ask a question, use the \`question\` marker type

`;
}

export function buildLeadSystemPrompt(): string {
  return `
### Your Role: LEAD (Supervisor Manager)

You receive a high-level task from the orchestrator, decompose it into
subtasks, and your subtask descriptions will be forwarded to worker agents.

**When given a task:**
1. Analyze and decompose into subtasks
2. Output a \`task_plan\` marker listing all subtasks
3. Workers will execute and report back

**Task Plan format:**

\`\`\`
[ACP_MESH_MESSAGE v2]
{
  "version": "2.0",
  "type": "task_plan",
  "id": "<uuid>",
  "from": "<your agent ID>",
  "to": "orchestrator",
  "mode": "supervisor",
  "payload": {
    "parentTaskId": "<task ID>",
    "subtasks": [
      { "index": 0, "description": "<subtask 1>", "complexity": "low" },
      { "index": 1, "description": "<subtask 2>", "complexity": "high" }
    ]
  }
}
[/ACP_MESH_MESSAGE]
\`\`\`

**Rules:**
- Output subtask descriptions that are clear and self-contained
- Each subtask should be independently executable
- Estimate complexity to help orchestrator with scheduling

`;
}

export function buildReviewerSystemPrompt(): string {
  return `
### Your Role: REVIEWER

You are responsible for **reviewing outputs** from other agents and providing feedback.

**When given a review request:**
1. Review the specified files/changes against the criteria
2. Output a \`review_response\` marker with your findings

**Review Response format:**

\`\`\`
[ACP_MESH_MESSAGE v2]
{
  "version": "2.0",
  "type": "review_response",
  "id": "<uuid>",
  "from": "<your agent ID>",
  "to": "<requester agent ID>",
  "mode": "supervisor",
  "payload": {
    "taskId": "<task ID>",
    "passed": true | false,
    "issues": [
      { "severity": "error | warning | info", "file": "<path>", "line": <number>, "message": "...", "suggestion": "..." }
    ]
  }
}
[/ACP_MESH_MESSAGE]
\`\`\`

`;
}

// ----------------------------------------------------------------------------
// User Prompt envelope helpers
// ----------------------------------------------------------------------------

function buildProtocolHeader(
  agentId: string,
  role: MeshAgentRole,
  mode: string
): string {
  return `---
## Mesh Protocol Header

Agent ID: ${agentId}
Role: ${role}
Mode: ${mode}
Protocol Version: 2

${getRoleSpecificReminder(role)}`;
}

function getRoleSpecificReminder(role: MeshAgentRole): string {
  switch (role) {
    case "planner":
      return "REMINDER: Use `plan_proposal` marker for plans, `task_request` for delegating.";
    case "worker":
      return "REMINDER: Always respond with `task_response` marker.";
    case "lead":
      return "REMINDER: Use `task_plan` marker to decompose tasks.";
    case "reviewer":
      return "REMINDER: Use `review_response` marker with pass/fail and issues.";
  }
}

function buildInboundContext(msg: InboundMessage): string {
  const payloadStr = JSON.stringify(msg.payload, null, 2);
  return `---
## Incoming Message (via Mesh Protocol)

You received a **${msg.type}** message from **${msg.from}**:
ID: ${msg.id}

\`\`\`json
${payloadStr}
\`\`\`

Respond to this message using the appropriate Mesh Marker. Include "metadata": { "replyTo": "${msg.id}" } in your response.`;
}

function buildContextSection(files: string[]): string {
  const fileList = files.map((f) => `- ${f}`).join("\n");
  return `---
## Context Files

The following files are available for reference:
${fileList}`;
}

/**
 * Wrap a user message with Mesh Protocol sections.
 * Called every turn.
 */
export function buildUserPromptEnvelope(params: {
  text: string;
  agentId: string;
  role: MeshAgentRole;
  mode: "direct" | "supervisor" | "p2P";
  inboundMessage?: InboundMessage;
  contextFiles?: string[];
}): string {
  const parts: string[] = [];

  parts.push(buildProtocolHeader(params.agentId, params.role, params.mode));

  if (params.inboundMessage) {
    parts.push(buildInboundContext(params.inboundMessage));
  }

  if (params.contextFiles?.length) {
    parts.push(buildContextSection(params.contextFiles));
  }

  parts.push(`---\n## Your Task\n\n${params.text}`);

  return parts.join("\n\n");
}

// ----------------------------------------------------------------------------
// Reinjection prompt (after context compression)
// ----------------------------------------------------------------------------

/**
 * Build a short reinjection prompt to re-inject Mesh Protocol instructions
 * after context compression. ~500 tokens, condensed version.
 */
export function buildReinjectionPrompt(
  config: MeshProtocolConfig,
  lastInbound?: InboundMessage
): string {
  if (!config.enabled) return "";

  const roleReminder = getRoleSpecificReminder(config.role);

  let prompt = `---
## Mesh Protocol Reinjection

Your context was compressed. Re-injecting Mesh Protocol instructions.

Agent ID: ${config.agentId}
Role: ${config.role}
Protocol Version: ${config.version}

${roleReminder}

**Marker format:**
\`\`\`
[ACP_MESH_MESSAGE v${config.version}]
{ "version": "${config.version}.0", "type": "<type>", "id": "<uuid>", "from": "${config.agentId}", "to": "<target>", "mode": "<mode>", "payload": { ... } }
[/ACP_MESH_MESSAGE]
\`\`\`
`;

  if (lastInbound) {
    prompt += `\n---\n## Last Incoming Message\n\nYou received **${lastInbound.type}** from **${lastInbound.from}** (ID: ${lastInbound.id}).\nRespond with the appropriate marker including "metadata": { "replyTo": "${lastInbound.id}" }.\n`;
  }

  return prompt;
}

// ----------------------------------------------------------------------------
// Reprompt (when agent failed to emit a marker)
// ----------------------------------------------------------------------------

/**
 * Build a reprompt message when the agent did not emit the expected marker.
 */
export function buildRepromptMessage(
  originalTask: string,
  agentOutput: string,
  expectedMarkerType: string
): string {
  return `---
## Mesh Protocol Reminder

Your previous response did not include the required Mesh Marker.

**Your previous output (summary):**
${agentOutput.substring(0, 200)}...

**Required action:**
Please re-submit your response, and this time include a \`${expectedMarkerType}\` marker.

**Original task:**
${originalTask}

**Marker format reminder:**
\`\`\`
[ACP_MESH_MESSAGE v2]
{
  "version": "2.0",
  "type": "${expectedMarkerType}",
  "id": "<generate UUID>",
  "from": "<your agent ID>",
  "to": "<target>",
  "mode": "supervisor",
  "payload": { ... }
}
[/ACP_MESH_MESSAGE]
\`\`\`

Please include the marker at the END of your response.`;
}

// ----------------------------------------------------------------------------
// PromptBuilder class
// ----------------------------------------------------------------------------

export class PromptBuilder {
  private config: MeshProtocolConfig;

  constructor(config: MeshProtocolConfig) {
    this.config = config;
  }

  /**
   * Generate the system prompt extension for agent startup.
   */
  buildSystemPromptExtension(): string {
    if (!this.config.enabled) return "";
    return buildMeshSystemPrompt(this.config) + this.buildRolePrompt();
  }

  private buildRolePrompt(): string {
    switch (this.config.role) {
      case "planner":
        return buildPlannerSystemPrompt();
      case "worker":
        return buildWorkerSystemPrompt();
      case "lead":
        return buildLeadSystemPrompt();
      case "reviewer":
        return buildReviewerSystemPrompt();
    }
  }

  /**
   * Wrap a user message with Mesh Protocol sections for each turn.
   */
  buildUserPrompt(params: {
    text: string;
    mode: "direct" | "supervisor" | "p2P";
    inboundMessage?: InboundMessage;
    contextFiles?: string[];
  }): string {
    return buildUserPromptEnvelope({
      ...params,
      agentId: this.config.agentId,
      role: this.config.role,
    });
  }

  /**
   * Build reinjection prompt after context compression.
   */
  buildReinjection(lastInbound?: InboundMessage): string {
    return buildReinjectionPrompt(this.config, lastInbound);
  }
}
