import * as vscode from "vscode";

/**
 * Default prompt used when pre-filling the Composer for a code review.
 * Overridable via the `acp.review.prompt` user/workspace setting.
 */
export const DEFAULT_REVIEW_PROMPT =
  "Please review the file changes attached below. Focus on correctness, potential bugs, edge cases, security issues, and adherence to the project's conventions. Provide specific, actionable feedback and suggest concrete fixes where appropriate.";

/**
 * Read the review prompt from settings, falling back to the default.
 */
export function getReviewPrompt(): string {
  return vscode.workspace
    .getConfiguration("acp")
    .get<string>("review.prompt", DEFAULT_REVIEW_PROMPT);
}
