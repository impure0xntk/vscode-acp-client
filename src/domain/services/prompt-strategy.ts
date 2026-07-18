/**
 * Strategy interface for role-specific prompt generation.
 *
 * Each mesh agent role (planner, worker, lead, reviewer) provides its own
 * implementation of this interface, generating the system prompt extension
 * and the role-specific reminder text.
 */
export interface RolePromptStrategy {
  /** Return the role-specific system prompt extension to inject at agent startup. */
  buildSystemPrompt(): string;

  /** Return the role-specific reminder text for the per-turn envelope header. */
  buildReminder(): string;
}
