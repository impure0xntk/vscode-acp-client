import type {
  PermissionOption,
  PermissionOptionKind,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { UIAPI, QuickPickItem } from "../../platform/ui";
import { getLogger } from "../../platform/backends";

// ---------------------------------------------------------------------------
// Permission handling extracted from ProtocolHandler
//
// Adapted from cline's permissions.ts pattern:
// - Translate tool call context into a QuickPick dialog
// - Map user selection back to ACP RequestPermissionResponse
// ---------------------------------------------------------------------------

const log = getLogger("permissions");

// ---------------------------------------------------------------------------
// Standard permission options presented to the user
// ---------------------------------------------------------------------------

const PERMISSION_OPTIONS: PermissionOption[] = [
  {
    optionId: "allow_once",
    name: "Allow once",
    kind: "allow_once" as PermissionOptionKind,
  },
  {
    optionId: "allow_always",
    name: "Allow always",
    kind: "allow_always" as PermissionOptionKind,
  },
  {
    optionId: "reject_once",
    name: "Reject",
    kind: "reject_once" as PermissionOptionKind,
  },
];

export interface PermissionHandlerDeps {
  ui: UIAPI;
}

/**
 * Present a permission request to the user via QuickPick and return the
 * corresponding ACP response.
 */
export async function requestPermissionViaQuickPick(
  deps: PermissionHandlerDeps,
  agentId: string,
  request: RequestPermissionRequest
): Promise<RequestPermissionResponse> {
  const qpItems: QuickPickItem[] = request.options.map((o) => ({
    label: o.name ?? o.optionId,
    description: o.kind ?? undefined,
    picked: false,
  }));

  const kindLabel = toolKindLabel(request.toolCall.kind ?? "");
  const title = `[${agentId}] ${kindLabel}: ${request.toolCall.title ?? "(no title)"}`;

  log.debug("showing permission dialog", {
    agentId,
    toolKind: request.toolCall.kind ?? "unknown",
    title,
    optionCount: request.options.length,
  });

  const result = await deps.ui.showQuickPick(qpItems, {
    placeHolder: title,
  });

  if (!result) {
    log.debug("permission dialog cancelled", { agentId });
    return { outcome: { outcome: "cancelled" } };
  }

  const label = (result as { label: string }).label;
  const matchedOption = request.options.find(
    (o) => (o.name ?? o.optionId) === label
  );
  const optionId = matchedOption?.optionId;
  if (!optionId) {
    log.debug("permission option not matched, cancelling", {
      agentId,
      label,
    });
    return { outcome: { outcome: "cancelled" } };
  }

  log.debug("permission option selected", { agentId, optionId });
  return { outcome: { outcome: "selected", optionId } };
}

/**
 * Return the standard permission options (allow once, allow always, reject).
 */
export function getStandardPermissionOptions(): PermissionOption[] {
  return PERMISSION_OPTIONS;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolKindLabel(kind: string): string {
  switch (kind) {
    case "edit":
      return "Edit";
    case "execute":
      return "Execute";
    case "fetch":
      return "Fetch";
    case "read":
      return "Read";
    case "search":
      return "Search";
    case "delete":
      return "Delete";
    case "move":
      return "Move";
    case "think":
      return "Think";
    default:
      return "Action";
  }
}
