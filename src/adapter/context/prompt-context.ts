// Single source of truth for attachment → ContentBlock conversion.
// Used by wireChatPanelEvents, MeshOrchestrator, FanoutExecutor, PipelineExecutor,
// and SupervisorManager to avoid duplicating the mapping logic and importing
// @agentclientprotocol/sdk types into the domain layer.

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ContextAttachmentDTO } from "../../domain/models/chat";

/**
 * Convert an array of context attachments to ACP ContentBlock[] suitable
 * for SessionOrchestrator.prompt() / session/prompt.
 *
 * Each attachment becomes a `resource` block with file URI, MIME type,
 * and full text content. The caller is responsible for prepending any
 * additional text blocks.
 */
export function attachmentsToContentBlocks(
  attachments: ContextAttachmentDTO[]
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const a of attachments) {
    // Problems are an aggregate across many files (or one external tool's
    // output), not a single document. Use a synthetic, self-describing URI
    // so the agent receives the formatted problem list as a resource
    // without mistaking it for a real `file://` path.
    if (a.type === "problem") {
      blocks.push({
        type: "resource",
        resource: {
          uri: "problems://diagnostics",
          mimeType: "text/plain",
          text: a.content,
        },
      });
      continue;
    }
    // A forwarded prior-turn output (cross-session hand-off). Use a synthetic
    // URI so the agent receives the text as a resource without mistaking it
    // for a real file:// path.
    if (a.type === "turn") {
      blocks.push({
        type: "resource",
        resource: {
          uri: "turn://session-output",
          mimeType: "text/plain",
          text: a.content,
        },
      });
      continue;
    }
    if (!a.path) continue;
    blocks.push({
      type: "resource",
      resource: {
        uri: `file://${a.path}`,
        mimeType: "text/plain",
        text: a.content,
      },
    });
  }
  return blocks;
}
