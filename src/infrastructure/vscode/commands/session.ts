import * as vscode from "vscode";
import type { SessionOrchestrator } from "../../../application/orchestrator";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import type { ContextAttachmentDTO } from "../../../domain/models/chat";
import type { PersistentHistoryStore } from "../../../application/session/persistentHistory";

export function registerSessionCommands(
  orchestrator: SessionOrchestrator,
  registry: {
    getAgent: (
      id: string
    ) => import("../../../application/orchestrator").AgentConfig | undefined;
    getAgents: () => import("../../../application/orchestrator").AgentConfig[];
  },
  getChatPanel: () => ChatPanel | null,
  ensureChatPanel: () => void,
  pickConnectedAgent: (placeHolder: string) => Promise<string | undefined>,
  historyStore: {
    getEntries: () => Array<{
      sessionId: string;
      agentId: string;
      title: string;
      cwd: string;
      status: string;
      createdAt: string;
      messageCount: number;
      tokenUsage: { input: number; output: number; total: number };
    }>;
    clear: () => Promise<void>;
  },
  persistentHistory: PersistentHistoryStore | null,
  resolveFile: (
    path: string,
    cwd?: string
  ) => Promise<import("../../../domain/models/chat").ContextAttachmentDTO>,
  resolveSelection: () => Promise<
    import("../../../domain/models/chat").ContextAttachmentDTO | null
  >,
  resolveDiff: () => Promise<
    import("../../../domain/models/chat").ContextAttachmentDTO | null
  >,
  sendTabsToChatPanel: () => void
): vscode.Disposable[] {
  // acp.newSession
  const newSessionCmd = vscode.commands.registerCommand(
    "acp.newSession",
    async () => {
      // Step 1: choose action — new or fork
      const action = await vscode.window.showQuickPick(
        [
          {
            label: "$(add) New session",
            description:
              "Create a fresh session with a chosen agent and working directory",
          },
          {
            label: "$(git-fork) Fork session",
            description:
              "Clone an existing session from the current session list",
          },
        ],
        { placeHolder: "Create or fork a session?" }
      );
      if (!action) return;

      if (action.label.startsWith("$(git-fork)")) {
        // ---- Fork flow ----
        const agentId = await pickConnectedAgent(
          "Select agent that owns the session to fork"
        );
        if (!agentId) return;
        const sessions = orchestrator.getSessionsForAgent(agentId);
        if (sessions.length === 0) {
          void vscode.window.showWarningMessage(
            "ACP: No sessions available to fork for this agent"
          );
          return;
        }
        const pick = await vscode.window.showQuickPick(
          sessions.map((s) => ({
            label: `$(circle-${s.status === "running" ? "filled" : "outline"}) ${s.title}`,
            description: `${s.sessionId.slice(0, 8)} · ${s.status}`,
            sessionId: s.sessionId,
          })),
          { placeHolder: "Select session to fork" }
        );
        if (!pick) return;
        try {
          const result = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Forking "${pick.label.replace(/^\$\([^)]+\)\s*/, "")}"…`,
              cancellable: false,
            },
            () => orchestrator.forkSession(agentId, pick.sessionId)
          );
          orchestrator.setActiveSession(agentId, result.sessionId);
          ensureChatPanel();
          const info = orchestrator.getSessionInfo(agentId, result.sessionId);
          if (info)
            getChatPanel()?.setActiveSession(agentId, result.sessionId, info);
          void vscode.window.showInformationMessage(
            `ACP: Forked session (${result.sessionId.slice(0, 8)}, ${result.replayedMessageCount} msgs replayed)`
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            `ACP: Fork failed — ${err instanceof Error ? err.message : String(err)}`
          );
        }
      } else {
        // ---- New session flow ----
        const agentId = await pickConnectedAgent(
          "Select agent for new session"
        );
        if (!agentId) return;
        // Build workspace folder picker items + "Browse…" option
        const wsFolders = vscode.workspace.workspaceFolders ?? [];
        type CwdItem = {
          label: string;
          description?: string;
          picked?: boolean;
          cwd: string;
        };
        const items: CwdItem[] = wsFolders.map((f, i) => ({
          label: `$(folder) ${f.name}`,
          description: f.uri.fsPath,
          picked: i === 0,
          cwd: f.uri.fsPath,
        }));
        items.push({
          label: "$(file-directory) Browse…",
          description: "Choose a directory from the system",
          cwd: "",
        });
        const cwdPick = await vscode.window.showQuickPick(items, {
          placeHolder: "Select working directory",
          canPickMany: false,
        });
        if (!cwdPick) return;
        let cwd = cwdPick.cwd;
        if (!cwd) {
          const defaultUri =
            wsFolders.length > 0
              ? wsFolders[0].uri
              : vscode.Uri.file(process.cwd());
          const selected = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Select working directory",
            defaultUri,
          });
          if (!selected?.length) return;
          cwd = selected[0].fsPath;
        }
        try {
          const sessionId = await orchestrator.createSession(agentId, cwd);
          ensureChatPanel();
          const info = orchestrator.getSessionInfo(agentId, sessionId);
          if (info) getChatPanel()?.setActiveSession(agentId, sessionId, info);
          void vscode.window.showInformationMessage(
            `ACP: New session created (${sessionId.slice(0, 8)})`
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            `ACP: Failed to create session — ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  );

  // acp.switchSession
  const switchSessionCmd = vscode.commands.registerCommand(
    "acp.switchSession",
    async () => {
      const agentId = await pickConnectedAgent("Select agent");
      if (!agentId) return;
      const sessions = orchestrator.getSessionsForAgent(agentId);
      if (sessions.length === 0) {
        void vscode.window.showWarningMessage(
          "ACP: No sessions for this agent"
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        sessions.map((s) => ({
          label: `$(circle-${orchestrator.getActiveSessionId(agentId) === s.sessionId ? "filled" : "outline"}) ${s.title}`,
          description: `${s.sessionId.slice(0, 8)} · ${s.status}`,
          sessionId: s.sessionId,
        })),
        { placeHolder: "Select session" }
      );
      if (!pick) return;
      ensureChatPanel();
      orchestrator.setActiveSession(agentId, pick.sessionId);
      const info = orchestrator.getSessionInfo(agentId, pick.sessionId);
      if (info) {
        getChatPanel()?.setActiveSession(agentId, pick.sessionId, info);
      }
    }
  );

  // acp.gotoSession — jump to any session across all agents in one picker
  const gotoSessionCmd = vscode.commands.registerCommand(
    "acp.gotoSession",
    async () => {
      const agents = orchestrator.getAllAgents();
      if (agents.length === 0) {
        void vscode.window.showWarningMessage("ACP: No connected agents");
        return;
      }

      // Collect all sessions across all agents
      type SessionItem = {
        label: string;
        description: string;
        detail?: string;
        agentId: string;
        sessionId: string;
      };
      const items: SessionItem[] = [];
      for (const agent of agents) {
        const activeSessionId = orchestrator.getActiveSessionId(agent.agentId);
        for (const s of agent.sessions) {
          const isActive = activeSessionId === s.sessionId;
          items.push({
            label: `$(circle-${isActive ? "filled" : "outline"}) ${s.title}`,
            description: `${agent.agentId} · ${s.sessionId.slice(0, 8)} · ${s.status}`,
            detail: isActive ? "active" : undefined,
            agentId: agent.agentId,
            sessionId: s.sessionId,
          });
        }
      }

      if (items.length === 0) {
        void vscode.window.showWarningMessage("ACP: No sessions available");
        return;
      }

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: "Select session to jump to",
        matchOnDescription: true,
      });
      if (!pick) return;

      ensureChatPanel();
      orchestrator.setActiveSession(pick.agentId, pick.sessionId);
      const info = orchestrator.getSessionInfo(pick.agentId, pick.sessionId);
      if (info) {
        getChatPanel()?.setActiveSession(pick.agentId, pick.sessionId, info);
      }
    }
  );

  const cancelTurnCmd = vscode.commands.registerCommand(
    "acp.cancelTurn",
    async () => {
      for (const agent of orchestrator.getAllAgents()) {
        for (const s of agent.sessions.filter(
          (ss) => ss.status === "running"
        )) {
          await orchestrator.cancel(agent.agentId, s.sessionId);
        }
      }
    }
  );

  // acp.attachFile
  const attachFileCmd = vscode.commands.registerCommand(
    "acp.attachFile",
    async (uri?: vscode.Uri) => {
      const activeAgent = orchestrator.getAllAgents()[0];
      const activeSessionId = activeAgent
        ? (orchestrator.getActiveSessionId(activeAgent.agentId) ??
          activeAgent.sessions[0]?.sessionId)
        : undefined;
      const sessionInfo =
        activeAgent && activeSessionId
          ? orchestrator.getSessionInfo(activeAgent.agentId, activeSessionId)
          : undefined;
      const cwd = sessionInfo?.cwd;

      let filePath: string;
      if (uri) {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
        filePath = require("path").relative(ws, uri.fsPath);
      } else {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "Attach",
        });
        if (!uris?.length) return;
        const ws2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
        filePath = require("path").relative(ws2, uris[0].fsPath);
      }
      const attachment = await resolveFile(filePath, cwd);
      addContextToChat(attachment, orchestrator, getChatPanel);
    }
  );

  // acp.attachSelection
  const attachSelectionCmd = vscode.commands.registerCommand(
    "acp.attachSelection",
    async () => {
      const attachment = await resolveSelection();
      if (!attachment) {
        void vscode.window.showWarningMessage("ACP: No text selected");
        return;
      }
      addContextToChat(attachment, orchestrator, getChatPanel);
    }
  );

  // acp.attachDiff
  const attachDiffCmd = vscode.commands.registerCommand(
    "acp.attachDiff",
    async () => {
      const attachment = await resolveDiff();
      if (!attachment) {
        void vscode.window.showWarningMessage("ACP: No git diff available");
        return;
      }
      addContextToChat(attachment, orchestrator, getChatPanel);
    }
  );

  // acp.forkSession
  const forkSessionCmd = vscode.commands.registerCommand(
    "acp.forkSession",
    async () => {
      const agentId = await pickConnectedAgent("Select agent");
      if (!agentId) return;
      const sessions = orchestrator.getSessionsForAgent(agentId);
      if (sessions.length === 0) {
        void vscode.window.showWarningMessage(
          "ACP: No sessions available to fork"
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        sessions.map((s) => ({
          label: s.title,
          description: `${s.sessionId.slice(0, 8)} · ${s.status}`,
          sessionId: s.sessionId,
        })),
        { placeHolder: "Select session to fork" }
      );
      if (!pick) return;
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Forking "${pick.label}"…`,
            cancellable: false,
          },
          () => orchestrator.forkSession(agentId, pick.sessionId)
        );
        orchestrator.setActiveSession(agentId, result.sessionId);
        ensureChatPanel();
        void vscode.window.showInformationMessage(
          `ACP: Forked session (${result.sessionId.slice(0, 8)}, ${result.replayedMessageCount} msgs replayed)`
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `ACP: Fork failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  // acp.restoreSession — select a past session and restore it as a new live session
  const restoreSessionCmd = vscode.commands.registerCommand(
    "acp.restoreSession",
    async () => {
      const entries = historyStore.getEntries();
      if (entries.length === 0) {
        void vscode.window.showInformationMessage("ACP: No session history");
        return;
      }
      const pick = await vscode.window.showQuickPick(
        entries.map((e) => ({
          label: `$(hubot) ${e.title}`,
          description: `${e.agentId} · ${e.sessionId.slice(0, 8)} · ${e.status}`,
          detail: `${e.messageCount} msgs · ↑${e.tokenUsage.input} ↓${e.tokenUsage.output} tokens`,
          entry: e,
        })),
        { placeHolder: "Select session to restore" }
      );
      if (!pick) return;

      const { sessionId: sourceSessionId, agentId } = pick.entry;
      const agentConfig = registry.getAgent(agentId);
      if (!agentConfig) {
        void vscode.window.showErrorMessage(
          `ACP: Agent "${agentId}" not found in configuration`
        );
        return;
      }

      // Ensure the agent is connected (needed for createSession + prompt)
      if (!orchestrator.getConnection(agentId)) {
        void vscode.window.showInformationMessage(
          `ACP: Connecting to "${agentConfig.name}" first…`
        );
        try {
          await orchestrator.connectAgent(agentId, agentConfig);
        } catch (err) {
          void vscode.window.showErrorMessage(
            `ACP: Failed to connect to "${agentConfig.name}" — ${err instanceof Error ? err.message : String(err)}`
          );
          return;
        }
      }

      // Restore: create a new session and replay messages from persistent history
      try {
        // Load full message history from persistent store
        const { messages } = persistentHistory
          ? persistentHistory.getSessionMessages(sourceSessionId)
          : { messages: [] };

        if (messages.length === 0) {
          void vscode.window.showWarningMessage(
            `ACP: No messages found for session "${pick.entry.title}"`
          );
          return;
        }

        // Show progress notification for replay
        const restoreResult = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Restoring "${pick.entry.title}" (${messages.length} messages)…`,
            cancellable: false,
          },
          async () => {
            return orchestrator.restoreSession(
              agentId,
              sourceSessionId,
              messages,
              pick.entry.cwd
            );
          }
        );

        // Activate the restored session in the UI
        ensureChatPanel();
        const newInfo = orchestrator.getSessionInfo(
          agentId,
          restoreResult.sessionId
        );
        const cp = getChatPanel();
        if (cp && newInfo) {
          // Push the full message history to the webview so the
          // restored conversation is visible immediately.
          cp.pushSessionSnapshot(agentId, restoreResult.sessionId, newInfo);
          cp.setActiveSession(agentId, restoreResult.sessionId, newInfo);
          // Explicitly switch the webview's active session so the
          // SingleSessionLayout renders SessionChatContainer for
          // this sessionKey instead of showing an empty panel.
          cp.postMessage({
            type: "session/switch",
            agentId,
            sessionId: restoreResult.sessionId,
          });
        }

        const methodLabel = restoreResult.nativeRestore
          ? "native restore"
          : `replayed ${restoreResult.replayedMessageCount} messages`;

        void vscode.window.showInformationMessage(
          `ACP: Restored "${pick.entry.title}" (${restoreResult.sessionId.slice(0, 8)}, ${methodLabel})`
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `ACP: Restore failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  // acp.clearHistory
  const clearHistoryCmd = vscode.commands.registerCommand(
    "acp.clearHistory",
    async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Clear all session history?",
        { modal: true },
        "Clear"
      );
      if (confirm !== "Clear") return;
      await historyStore.clear();
      void vscode.window.showInformationMessage("ACP: Session history cleared");
    }
  );

  // acp.closeSession — close a single session by id (must find owning agent)
  const closeSessionCmd = vscode.commands.registerCommand(
    "acp.closeSession",
    async (sessionId?: string) => {
      if (!sessionId) {
        // No session id provided — pick from active agent
        const agentId = await pickConnectedAgent(
          "Select agent that owns the session to close"
        );
        if (!agentId) return;
        const sessions = orchestrator.getSessionsForAgent(agentId);
        if (sessions.length === 0) {
          void vscode.window.showWarningMessage(
            "ACP: No sessions to close for this agent"
          );
          return;
        }
        const pick = await vscode.window.showQuickPick(
          sessions.map((s) => ({
            label: `$(circle-${s.status === "running" ? "filled" : "outline"}) ${s.title}`,
            description: `${s.sessionId.slice(0, 8)} · ${s.status}`,
            sessionId: s.sessionId,
          })),
          { placeHolder: "Select session to close" }
        );
        if (!pick) return;
        sessionId = pick.sessionId;
      }
      // Find which agent owns this session
      for (const agent of orchestrator.getAllAgents()) {
        const info = orchestrator.getSessionInfo(agent.agentId, sessionId);
        if (info) {
          await orchestrator.closeSession(agent.agentId, sessionId);
          sendTabsToChatPanel();
          return;
        }
      }
      void vscode.window.showWarningMessage(
        `ACP: Session "${sessionId}" not found`
      );
    }
  );

  // acp.closeAllSessions
  const closeAllCmd = vscode.commands.registerCommand(
    "acp.closeAllSessions",
    async () => {
      for (const agent of orchestrator.getAllAgents()) {
        for (const s of agent.sessions) {
          await orchestrator.closeSession(agent.agentId, s.sessionId);
        }
      }
      sendTabsToChatPanel();
    }
  );

  // acp.newSessionAndPin — create a new session and pin it in one step
  const newSessionAndPinCmd = vscode.commands.registerCommand(
    "acp.newSessionAndPin",
    async () => {
      const agentId = await pickConnectedAgent("Select agent for new session");
      if (!agentId) return;

      const wsFolders = vscode.workspace.workspaceFolders ?? [];
      type CwdItem = {
        label: string;
        description?: string;
        picked?: boolean;
        cwd: string;
      };
      const items: CwdItem[] = wsFolders.map((f, i) => ({
        label: `$(folder) ${f.name}`,
        description: f.uri.fsPath,
        picked: i === 0,
        cwd: f.uri.fsPath,
      }));
      items.push({
        label: "$(file-directory) Browse…",
        description: "Choose a directory from the system",
        cwd: "",
      });
      const cwdPick = await vscode.window.showQuickPick(items, {
        placeHolder: "Select working directory",
        canPickMany: false,
      });
      if (!cwdPick) return;
      let cwd = cwdPick.cwd;
      if (!cwd) {
        const defaultUri =
          wsFolders.length > 0
            ? wsFolders[0].uri
            : vscode.Uri.file(process.cwd());
        const selected = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: "Select working directory",
          defaultUri,
        });
        if (!selected?.length) return;
        cwd = selected[0].fsPath;
      }
      try {
        const sessionId = await orchestrator.createSession(agentId, cwd);
        orchestrator.pinSession(agentId, sessionId);
        orchestrator.setActiveSession(agentId, sessionId);
        ensureChatPanel();
        const info = orchestrator.getSessionInfo(agentId, sessionId);
        if (info) getChatPanel()?.setActiveSession(agentId, sessionId, info);
        void vscode.window.showInformationMessage(
          `ACP: New session created and pinned (${sessionId.slice(0, 8)})`
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `ACP: Failed to create session — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  // acp.pinSession
  const pinSessionCmd = vscode.commands.registerCommand(
    "acp.pinSession",
    async () => {
      const agentId = await pickConnectedAgent("Select agent");
      if (!agentId) return;
      const sessions = orchestrator.getSessionsForAgent(agentId);
      if (sessions.length === 0) {
        void vscode.window.showWarningMessage(
          "ACP: No sessions for this agent"
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        sessions.map((s) => ({
          label: `$(circle-${s.status === "running" ? "filled" : "outline"}) ${s.title}`,
          description: `${s.sessionId.slice(0, 8)} · ${s.status}`,
          sessionId: s.sessionId,
        })),
        { placeHolder: "Select session to pin" }
      );
      if (!pick) return;
      orchestrator.pinSession(agentId, pick.sessionId);
    }
  );

  // acp.unpinSession
  const unpinSessionCmd = vscode.commands.registerCommand(
    "acp.unpinSession",
    async () => {
      const agentId = await pickConnectedAgent("Select agent");
      if (!agentId) return;
      const sessions = orchestrator.getSessionsForAgent(agentId);
      if (sessions.length === 0) {
        void vscode.window.showWarningMessage(
          "ACP: No sessions for this agent"
        );
        return;
      }
      const pinnedIds = orchestrator.getPinnedSessions(agentId);
      if (pinnedIds.length === 0) {
        void vscode.window.showWarningMessage(
          "ACP: No pinned sessions for this agent"
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        pinnedIds.map((sid) => {
          const s = sessions.find((ss) => ss.sessionId === sid);
          return {
            label: `$(circle-${s?.status === "running" ? "filled" : "outline"}) ${s?.title ?? sid.slice(0, 8)}`,
            description: `${sid.slice(0, 8)} · ${s?.status ?? "unknown"}`,
            sessionId: sid,
          };
        }),
        { placeHolder: "Select session to unpin" }
      );
      if (!pick) return;
      orchestrator.unpinSession(agentId, pick.sessionId);
    }
  );

  // acp.renameSession
  const renameSessionCmd = vscode.commands.registerCommand(
    "acp.renameSession",
    async () => {
      const agentId = await pickConnectedAgent("Select agent");
      if (!agentId) return;
      const sessions = orchestrator.getSessionsForAgent(agentId);
      if (sessions.length === 0) {
        void vscode.window.showWarningMessage(
          "ACP: No sessions for this agent"
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        sessions.map((s) => ({
          label: `$(circle-${s.status === "running" ? "filled" : "outline"}) ${s.title}`,
          description: `${s.sessionId.slice(0, 8)} · ${s.status}`,
          sessionId: s.sessionId,
        })),
        { placeHolder: "Select session to rename" }
      );
      if (!pick) return;
      const newName = await vscode.window.showInputBox({
        prompt: "New session name",
        value:
          sessions.find((s) => s.sessionId === pick.sessionId)?.title ?? "",
        validateInput: (v) =>
          v.trim().length === 0 ? "Name cannot be empty" : undefined,
      });
      if (!newName) return;
      try {
        orchestrator.renameSession(agentId, pick.sessionId, newName);
        sendTabsToChatPanel();
        void vscode.window.showInformationMessage(
          `ACP: Session renamed to "${newName.trim()}"`
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `ACP: Rename failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  // acp.showAgentMenu
  const showAgentMenuCmd = vscode.commands.registerCommand(
    "acp.showAgentMenu",
    async () => {
      const agents = orchestrator.getAllAgents();
      const items: vscode.QuickPickItem[] =
        agents.length > 0
          ? [
              {
                label: "$(add) New Session",
                description: "Create a new session",
              },
              {
                label: "$(close) Close All Sessions",
                description: "Close all sessions",
              },
              {
                label: "$(output) Show Output",
                description: "Show agent output channel",
              },
              {
                label: "$(debug-disconnect) Disconnect",
                description: "Disconnect from agent",
              },
            ]
          : [
              {
                label: "$(plug) Connect to Agent",
                description: "Start an ACP agent connection",
              },
            ];
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: "ACP Agent Menu",
      });
      if (!pick) return;
      switch (pick.label) {
        case "$(add) New Session":
          void vscode.commands.executeCommand("acp.newSession");
          break;
        case "$(close) Close All Sessions":
          void vscode.commands.executeCommand("acp.closeAllSessions");
          break;
        case "$(output) Show Output":
          void vscode.window.showWarningMessage(
            "ACP: showTraffic not yet implemented"
          );
          break;
        case "$(debug-disconnect) Disconnect":
          void vscode.commands.executeCommand("acp.disconnect");
          break;
        case "$(plug) Connect to Agent":
          break; // handled by connect command
      }
    }
  );

  // Helper: disconnect command extracted as standalone for reuse
  async function disconnectCmd(agentId?: string): Promise<void> {
    const agents = orchestrator.getAllAgents();
    if (agents.length === 0) {
      void vscode.window.showWarningMessage("ACP: No active connection");
      return;
    }
    if (agents.length === 1 || agentId) {
      await orchestrator.disconnectAgent(agentId ?? agents[0].agentId);
      return;
    }
    const pick = await vscode.window.showQuickPick(
      agents.map((a) => ({
        label: `$(hubot) ${a.agentId}`,
        description: a.state,
        aId: a.agentId,
      })),
      { placeHolder: "Select agent to disconnect" }
    );
    if (!pick) return;
    await orchestrator.disconnectAgent(pick.aId);
  }

  return [
    newSessionCmd,
    newSessionAndPinCmd,
    switchSessionCmd,
    gotoSessionCmd,
    cancelTurnCmd,
    attachFileCmd,
    attachSelectionCmd,
    attachDiffCmd,
    forkSessionCmd,
    restoreSessionCmd,
    pinSessionCmd,
    unpinSessionCmd,
    renameSessionCmd,
    clearHistoryCmd,
    closeAllCmd,
    showAgentMenuCmd,
  ];
}

function addContextToChat(
  attachment: ContextAttachmentDTO,
  orchestrator: SessionOrchestrator,
  getChatPanel: () => ChatPanel | null
): void {
  const agents = orchestrator.getAllAgents();
  if (agents.length === 0) return;
  const agent = agents[0];
  const activeSessionId =
    orchestrator.getActiveSessionId(agent.agentId) ??
    agent.sessions[0]?.sessionId;
  if (!activeSessionId) return;
  const info = orchestrator.getSessionInfo(agent.agentId, activeSessionId);
  getChatPanel()?.pushMessage(
    agent.agentId,
    activeSessionId,
    {
      id: crypto.randomUUID(),
      role: "system",
      content: `📎 ${attachment.label} (${attachment.tokenCount} tokens)`,
      timestamp: Date.now(),
    },
    info?.cwd
  );
}
