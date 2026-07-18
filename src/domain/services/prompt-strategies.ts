/**
 * Role-specific prompt strategies — Planner, Worker, Lead, Reviewer.
 *
 * Each strategy implements {@link RolePromptStrategy} and is created via
 * {@link createRoleStrategy}.  Extracted from the original inline switch-case
 * in {@link PromptBuilder} to follow the Strategy pattern (Phase 6).
 */

import {
  buildPlannerSystemPrompt,
  buildWorkerSystemPrompt,
  buildLeadSystemPrompt,
  buildReviewerSystemPrompt,
} from "./prompt-builder";
import type { RolePromptStrategy } from "./prompt-strategy";

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export class PlannerStrategy implements RolePromptStrategy {
  buildSystemPrompt(): string {
    return buildPlannerSystemPrompt();
  }

  buildReminder(): string {
    return "REMINDER: Use `plan_proposal` marker for plans, `task_request` for delegating.";
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class WorkerStrategy implements RolePromptStrategy {
  buildSystemPrompt(): string {
    return buildWorkerSystemPrompt();
  }

  buildReminder(): string {
    return "REMINDER: Always respond with `task_response` marker.";
  }
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

export class LeadStrategy implements RolePromptStrategy {
  buildSystemPrompt(): string {
    return buildLeadSystemPrompt();
  }

  buildReminder(): string {
    return "REMINDER: Use `task_plan` marker to decompose tasks.";
  }
}

// ---------------------------------------------------------------------------
// Reviewer
// ---------------------------------------------------------------------------

export class ReviewerStrategy implements RolePromptStrategy {
  buildSystemPrompt(): string {
    return buildReviewerSystemPrompt();
  }

  buildReminder(): string {
    return "REMINDER: Use `review_response` marker with pass/fail and issues.";
  }
}

// ---------------------------------------------------------------------------
// Factory — picks the right strategy for a role.
// ---------------------------------------------------------------------------

import type { MeshAgentRole } from "./prompt-builder";

/** Return a {@link RolePromptStrategy} for the given mesh agent role. */
export function createRoleStrategy(role: MeshAgentRole): RolePromptStrategy {
  switch (role) {
    case "planner":
      return new PlannerStrategy();
    case "worker":
      return new WorkerStrategy();
    case "lead":
      return new LeadStrategy();
    case "reviewer":
      return new ReviewerStrategy();
  }
}
