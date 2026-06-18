import React, { useState, useEffect, useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

interface AgentInfo {
  agentId: string;
  state:
    | "connecting"
    | "connected"
    | "idle"
    | "busy"
    | "error"
    | "disconnected";
  command: string;
  sessionCount: number;
  lastError?: string;
}

interface AgentConnectPanelProps {
  onClose: () => void;
}

// ============================================================================
// VS Code API
// ============================================================================

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// ============================================================================
// Helpers
// ============================================================================

function getStatusIcon(state: AgentInfo["state"]): string {
  switch (state) {
    case "connected":
      return "plug";
    case "busy":
      return "sync~spin";
    case "error":
      return "error";
    case "connecting":
      return "loading~spin";
    case "idle":
    case "disconnected":
    default:
      return "debug-disconnect";
  }
}

function getStatusClass(state: AgentInfo["state"]): string {
  switch (state) {
    case "connected":
      return "status-connected";
    case "busy":
      return "status-busy";
    case "error":
      return "status-error";
    case "connecting":
      return "status-connecting";
    case "idle":
    case "disconnected":
    default:
      return "status-disconnected";
  }
}

function canConnect(state: AgentInfo["state"]): boolean {
  return state === "disconnected" || state === "idle" || state === "error";
}

function canDisconnect(state: AgentInfo["state"]): boolean {
  return state === "connected" || state === "busy" || state === "connecting";
}

// ============================================================================
// Component
// ============================================================================

export default function AgentConnectPanel({ onClose }: AgentConnectPanelProps) {
  const vscode = acquireVsCodeApi();

  const [agents, setAgents] = useState<AgentInfo[]>([]);

  // New agent form
  const [newAgentId, setNewAgentId] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");

  // ------------------------------------------------------------------
  // Receive messages from the extension host
  // ------------------------------------------------------------------
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case "agentList":
          setAgents(msg.agents as AgentInfo[]);
          break;
        case "agentUpdated":
          setAgents((prev) =>
            prev.map((a) => (a.agentId === msg.agent.agentId ? msg.agent : a))
          );
          break;
      }
    };
    window.addEventListener("message", handler);
    // Request initial list
    vscode.postMessage({ type: "getAgentList" });
    return () => window.removeEventListener("message", handler);
  }, [vscode]);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  const handleConnect = useCallback(
    (agentId: string) => {
      vscode.postMessage({ type: "connectAgent", agentId });
    },
    [vscode]
  );

  const handleDisconnect = useCallback(
    (agentId: string) => {
      vscode.postMessage({ type: "disconnectAgent", agentId });
    },
    [vscode]
  );

  const handleAddAgent = useCallback(() => {
    const id = newAgentId.trim();
    const cmd = newCommand.trim();
    if (!id || !cmd) return;

    vscode.postMessage({
      type: "addAgent",
      agentId: id,
      command: cmd,
      args: newArgs
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    });

    setNewAgentId("");
    setNewCommand("");
    setNewArgs("");
  }, [vscode, newAgentId, newCommand, newArgs]);

  const handleRemoveAgent = useCallback(
    (agentId: string) => {
      vscode.postMessage({ type: "removeAgent", agentId });
    },
    [vscode]
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="session-history-panel">
      {/* Header */}
      <div className="history-header">
        <h3 className="history-title">Agent Connections</h3>
        <button className="history-close-btn" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {/* Agent list */}
      <div className="history-list">
        {agents.length === 0 ? (
          <div className="history-empty">No agents configured yet.</div>
        ) : (
          agents.map((agent) => (
            <div key={agent.agentId} className="agent-item">
              <div className="agent-item-left">
                <span
                  className={`agent-status-icon ${getStatusClass(agent.state)}`}
                  title={agent.state}
                >
                  {getStatusIcon(agent.state)}
                </span>
                <div className="agent-item-main">
                  <span className="agent-item-name">{agent.agentId}</span>
                  <span className="agent-item-command">{agent.command}</span>
                </div>
              </div>

              <div className="agent-item-right">
                <span className="agent-session-count">
                  {agent.sessionCount}{" "}
                  {agent.sessionCount === 1 ? "session" : "sessions"}
                </span>

                {canConnect(agent.state) && (
                  <button
                    className="agent-connect-btn"
                    onClick={() => handleConnect(agent.agentId)}
                    title="Connect"
                  >
                    Connect
                  </button>
                )}

                {canDisconnect(agent.state) && (
                  <button
                    className="agent-disconnect-btn"
                    onClick={() => handleDisconnect(agent.agentId)}
                    title="Disconnect"
                  >
                    Disconnect
                  </button>
                )}

                <button
                  className="agent-remove-btn"
                  onClick={() => handleRemoveAgent(agent.agentId)}
                  title="Remove agent"
                >
                  ×
                </button>
              </div>

              {agent.lastError && (
                <div className="agent-item-error">{agent.lastError}</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add Agent form */}
      <div className="agent-add-section">
        <div className="agent-add-title">Add Agent</div>
        <div className="agent-add-row">
          <input
            type="text"
            className="agent-add-input"
            placeholder="Agent name"
            value={newAgentId}
            onChange={(e) => setNewAgentId(e.target.value)}
          />
        </div>
        <div className="agent-add-row">
          <input
            type="text"
            className="agent-add-input"
            placeholder="Command (e.g. npx)"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
          />
        </div>
        <div className="agent-add-row">
          <input
            type="text"
            className="agent-add-input"
            placeholder="Arguments (space-separated, optional)"
            value={newArgs}
            onChange={(e) => setNewArgs(e.target.value)}
          />
        </div>
        <div className="agent-add-row">
          <button
            className="agent-add-btn"
            onClick={handleAddAgent}
            disabled={!newAgentId.trim() || !newCommand.trim()}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
