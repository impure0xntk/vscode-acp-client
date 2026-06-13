import * as vscode from "vscode";
import type { SessionOrchestrator } from "../../../application/orchestrator";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import type { ContextAttachmentDTO } from "../../../domain/models/chat";

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
      updatedAt: string;
      messageCount: number;
      tokenUsage: { input: number; output: number; total: number };
    }>;
    clear: () => Promise<void>;
  },
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
        // Pick agent
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
        // Pick source session
        const pick = await vscode.window.showQuickPick(
          sessions.map((s) => ({
            label: `$(circle-${s.status === "running" ? "filled" : "outline"}) ${s.title}`,
            description: `${s.sessionId.slice(0, 8)} · ${s.status} · ${s.messages.length} msgs`,
            sessionId: s.sessionId,
          })),
          { placeHolder: "Select session to fork" }
        );
        if (!pick) return;
        try {
          const srcInfo = orchestrator.getSessionInfo(agentId, pick.sessionId);
          if (!srcInfo) return;
          const newId = await orchestrator.createSession(agentId, srcInfo.cwd);
          for (const msg of srcInfo.messages) {
            orchestrator.appendMessageSilent(agentId, newId, msg);
          }
          orchestrator.setActiveSession(agentId, newId);
          ensureChatPanel();
          const info = orchestrator.getSessionInfo(agentId, newId);
          if (info) getChatPanel()?.setActiveSession(agentId, newId, info);
          void vscode.window.showInformationMessage(
            `ACP: Forked session (${newId.slice(0, 8)})`
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
        // Build workspace folder picker items + "Other…" option
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
          label: "$(file-directory) Other…",
          description: "Enter a custom path",
          cwd: "",
        });
        const cwdPick = await vscode.window.showQuickPick(items, {
          placeHolder: "Select working directory",
          canPickMany: false,
        });
        if (!cwdPick) return;
        let cwd = cwdPick.cwd;
        if (!cwd) {
          const fallback =
            wsFolders.length > 0 ? wsFolders[0].uri.fsPath : process.cwd();
          const input = await vscode.window.showInputBox({
            prompt: "Working directory for new session",
            value: fallback,
          });
          if (!input) return;
          cwd = input;
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
    }
  );

  // acp.cancelTurn
  const cancelTurnCmd = vscode.commands.registerCommand(
    "acp.cancelTurn",
    async () => {
      for (const agent of orchestrator.getAllAgents()) {
        for (const s of agent.sessions.filter(
          (ss) => ss.status === "running"
        )) {
          orchestrator.setIsTurnActive(agent.agentId, s.sessionId, false);
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
      if (sessions.length === 0) return;
      const pick = await vscode.window.showQuickPick(
        sessions.map((s) => ({
          label: s.title,
          description: s.sessionId.slice(0, 8),
          sessionId: s.sessionId,
        })),
        { placeHolder: "Select session to fork" }
      );
      if (!pick) return;
      try {
        const srcInfo = orchestrator.getSessionInfo(agentId, pick.sessionId);
        if (!srcInfo) return;
        const newId = await orchestrator.createSession(agentId, srcInfo.cwd);
        // Copy source messages before activating so the snapshot is complete
        for (const msg of srcInfo.messages) {
          orchestrator.appendMessageSilent(agentId, newId, msg);
        }
        // setActiveSession emits sessionActiveChanged → chatPanel.setActiveSession(snapshot)
        orchestrator.setActiveSession(agentId, newId);
        ensureChatPanel();
        void vscode.window.showInformationMessage(
          `ACP: Forked session ${newId.slice(0, 8)}`
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `ACP: Fork failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  // acp.showHistory
  const showHistoryCmd = vscode.commands.registerCommand(
    "acp.showHistory",
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
        { placeHolder: "Session history" }
      );
      if (!pick) return;
      const agentConfig = registry.getAgent(pick.entry.agentId);
      if (!agentConfig) {
        void vscode.window.showErrorMessage(
          `ACP: Agent "${pick.entry.agentId}" not found in configuration`
        );
        return;
      }
      if (!orchestrator.getConnection(pick.entry.agentId)) {
        void vscode.window.showInformationMessage(
          `ACP: Agent "${agentConfig.name}" needs reconnection to load session`
        );
      }
      void vscode.window.showInformationMessage(
        `ACP: Session history entry selected (${pick.entry.sessionId.slice(0, 8)})`
      );
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
    switchSessionCmd,
    cancelTurnCmd,
    attachFileCmd,
    attachSelectionCmd,
    attachDiffCmd,
    forkSessionCmd,
    showHistoryCmd,
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
