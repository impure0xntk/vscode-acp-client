// ============================================================================
// PromptContext builder — converts ContextAttachmentDTO[] to ACP ContentBlock[]
//
// Single source of truth for attachment → ContentBlock conversion.
// Used by wireChatPanelEvents, MeshOrchestrator, FanoutExecutor, PipelineExecutor,
// and SupervisorManager to avoid duplicating the mapping logic and importing
// @agentclientprotocol/sdk types into the domain layer.
// ============================================================================

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
  attachments: ContextAttachmentDTO[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const a of attachments) {
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
