import { MessageRouter, type MessageHandler } from "../MessageRouter";

// -- Tabs ---------------------------------------------------------------------
import {
  handleSetTabs as _setTabs,
  handleAddTab as _addTab,
  handleUpdateTab as _updateTab,
  handleSetActiveSession as _setActiveSession,
} from "./tab";

// -- Session: message ---------------------------------------------------------
import { handleSessionMessage as _sessionMessage } from "./session/message";

// -- Session: stream ----------------------------------------------------------
import {
  handleSessionStream as _sessionStream,
  handleSessionStreamStart as _sessionStreamStart,
  handleSessionStreamEnd as _sessionStreamEnd,
} from "./session/stream";

// -- Session: turn ------------------------------------------------------------
import {
  handleSessionSwitch as _sessionSwitch,
  handleSessionTurnActive as _sessionTurnActive,
  handleSessionTurnEnded as _sessionTurnEnded,
} from "./session/turn";

// -- Session: snapshot / info / usage / compression / completed ---------------
import {
  handleSessionSnapshot as _sessionSnapshot,
  handleSessionInfo as _sessionInfo,
  handleSessionUsage as _sessionUsage,
  handleSessionCompression as _sessionCompression,
  handleSessionCompleted as _sessionCompleted,
} from "./session/snapshot";

// -- Session: notification / fileWrite ----------------------------------------
import {
  handleSessionNotification as _sessionNotification,
  handleSessionFileWrite as _sessionFileWrite,
} from "./session/notification";

// -- Session: auxiliary (agentInfo, statusline, commands, queue, title, pin) --
import {
  handleAgentInfo as _agentInfo,
  handleStatusline as _statusline,
  handleSessionCommands as _sessionCommands,
  handleQueueAdded as _queueAdded,
  handleQueueUpdated as _queueUpdated,
  handleQueueDequeued as _queueDequeued,
  handleSessionTitle as _sessionTitle,
  handleSessionPinned as _sessionPinned,
  handleSessionUnpinned as _sessionUnpinned,
} from "./session/auxiliary";

// -- Mesh ---------------------------------------------------------------------
import {
  handleMeshStatus as _meshStatus,
  handleMeshTeamCreated as _meshTeamCreated,
  handleMeshTaskBoard as _meshTaskBoard,
  handleMeshMessage as _meshMessage,
  handleMeshAgentConnected as _meshAgentConnected,
  handleMeshAgentDisconnected as _meshAgentDisconnected,
  handleMeshPanelToggle as _meshPanelToggle,
  handleMeshTeamUpdated as _meshTeamUpdated,
  handleMeshStartTeam as _meshStartTeam,
  handleMeshOpenTeamCreate as _meshOpenTeamCreate,
  handleMeshAddMemberToTeam as _meshAddMember,
  handleMeshRemoveMemberFromTeam as _meshRemoveMember,
} from "./mesh/mesh";

// -- Plan ---------------------------------------------------------------------
import {
  handlePlanUpdate as _planUpdate,
  handlePlanStepUpdate as _planStepUpdate,
  handlePlanCancelled as _planCancelled,
} from "./plan/plan";

// -- UI -----------------------------------------------------------------------
import {
  handleSessionOverviewState as _overviewState,
  handleSessionOverviewToggle as _overviewToggle,
  handleSessionOverviewPosition as _overviewPosition,
  handleUnifiedChatSetSplitDirection as _splitDir,
  handlePanelModeSet as _panelMode,
  handleComposerFocus as _composerFocus,
} from "./ui/ui";

// -- Context / Attach ---------------------------------------------------------
import {
  handlePathsResolved as _pathsResolved,
  handleReviewPrepare as _reviewPrepare,
  handleFixPrepare as _fixPrepare,
  handleResolvedExternalFile as _resolvedExt,
  handleAttachContext as _attachCtx,
  handleAgentStatus as _agentStatus,
  handleMeshPlan as _meshPlan,
} from "./context/context";

// Re-export setPendingSwitch for AppContainer
import { setPendingSwitch } from "../shared/guards";
export { setPendingSwitch };

/** Register all webview message handlers on the router. */
export function setupAllHandlers(router: MessageRouter): void {
  // Each handler is typed within its own module.  The router stores
  // `(data: unknown) => void` internally, so we widen each handler
  // to MessageHandler here.  Runtime correctness is enforced by
  // the message type string routing and integration tests.
  router.registerAll({
    // -- Tabs -----------------------------------------------------------------
    setTabs: _setTabs as unknown as MessageHandler,
    addTab: _addTab as unknown as MessageHandler,
    updateTab: _updateTab as unknown as MessageHandler,
    setActiveSession: _setActiveSession as unknown as MessageHandler,

    // -- Session --------------------------------------------------------------
    "session/message": _sessionMessage as unknown as MessageHandler,
    "session/stream": _sessionStream as unknown as MessageHandler,
    "session/streamStart": _sessionStreamStart as unknown as MessageHandler,
    "session/streamEnd": _sessionStreamEnd as unknown as MessageHandler,
    "session/switch": _sessionSwitch as unknown as MessageHandler,
    "session/turnActive": _sessionTurnActive as unknown as MessageHandler,
    "session/usage": _sessionUsage as unknown as MessageHandler,
    "session/compression": _sessionCompression as unknown as MessageHandler,
    "session/turnEnded": _sessionTurnEnded as unknown as MessageHandler,
    "session/completed": _sessionCompleted as unknown as MessageHandler,
    "session/snapshot": _sessionSnapshot as unknown as MessageHandler,
    "session/info": _sessionInfo as unknown as MessageHandler,
    "session/title": _sessionTitle as unknown as MessageHandler,
    "session.pinned": _sessionPinned as unknown as MessageHandler,
    "session.unpinned": _sessionUnpinned as unknown as MessageHandler,
    "session/commands": _sessionCommands as unknown as MessageHandler,
    "session/notification": _sessionNotification as unknown as MessageHandler,
    "session/webviewFileWrite": _sessionFileWrite as unknown as MessageHandler,

    // -- Queue ----------------------------------------------------------------
    "queue:added": _queueAdded as unknown as MessageHandler,
    "queue:updated": _queueUpdated as unknown as MessageHandler,
    "queue:dequeued": _queueDequeued as unknown as MessageHandler,

    // -- Agent ----------------------------------------------------------------
    agentInfo: _agentInfo as unknown as MessageHandler,
    "agent.status": _agentStatus as unknown as MessageHandler,

    // -- Statusline -----------------------------------------------------------
    statusline: _statusline as unknown as MessageHandler,

    // -- UI / Overview --------------------------------------------------------
    "sessionOverview:state": _overviewState as unknown as MessageHandler,
    "sessionOverview:toggle": _overviewToggle as unknown as MessageHandler,
    "sessionOverview:position": _overviewPosition as unknown as MessageHandler,
    "unifiedChat:setSplitDirection": _splitDir as unknown as MessageHandler,
    "panelMode:set": _panelMode as unknown as MessageHandler,
    "composer:focus": _composerFocus as unknown as MessageHandler,

    // -- Mesh -----------------------------------------------------------------
    "mesh:status": _meshStatus as unknown as MessageHandler,
    "mesh:taskBoard": _meshTaskBoard as unknown as MessageHandler,
    "mesh:message": _meshMessage as unknown as MessageHandler,
    "mesh:agentConnected": _meshAgentConnected as unknown as MessageHandler,
    "mesh:agentDisconnected":
      _meshAgentDisconnected as unknown as MessageHandler,
    "mesh:togglePanel": _meshPanelToggle as unknown as MessageHandler,
    "mesh:startTeam": _meshStartTeam as unknown as MessageHandler,
    "mesh:teamCreated": _meshTeamCreated as unknown as MessageHandler,
    "mesh:openTeamCreate": _meshOpenTeamCreate as unknown as MessageHandler,
    "mesh:plan": _meshPlan as unknown as MessageHandler,
    "mesh:addMemberToTeam": _meshAddMember as unknown as MessageHandler,
    "mesh:removeMemberFromTeam": _meshRemoveMember as unknown as MessageHandler,
    "mesh:teamUpdated": _meshTeamUpdated as unknown as MessageHandler,

    // -- Plan -----------------------------------------------------------------
    "plan.update": _planUpdate as unknown as MessageHandler,
    "plan.stepUpdate": _planStepUpdate as unknown as MessageHandler,
    "plan.cancelled": _planCancelled as unknown as MessageHandler,

    // -- Context / Attach -----------------------------------------------------
    pathsResolved: _pathsResolved as unknown as MessageHandler,
    "review:prepare": _reviewPrepare as unknown as MessageHandler,
    "fix:prepare": _fixPrepare as unknown as MessageHandler,
    resolvedExternalFile: _resolvedExt as unknown as MessageHandler,
    attachContext: _attachCtx as unknown as MessageHandler,

    // -- File Edit (stale check) ---------------------------------------------
    // hashCheckResult is emitted by the extension in response to
    // checkFileHashBatch (sent from FileEditSummary for stale detection).
    // FileEditSummary consumes it via its own window listener; register a
    // no-op here so the MessageRouter doesn't log "unhandled message type".
    hashCheckResult: (() => {}) as unknown as MessageHandler,
  });
}
