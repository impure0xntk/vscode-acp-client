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

function getStatusColor(state: AgentInfo["state"]): string {
  switch (state) {
    case "connected":
      return "var(--success)";
    case "busy":
      return "#4fc3f7";
    case "error":
      return "var(--error)";
    case "connecting":
      return "var(--warning)";
    case "idle":
    case "disconnected":
    default:
      return "var(--fg-muted)";
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
    <div className="flex flex-col h-screen overflow-hidden bg-bg-primary text-fg-primary text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <h3 className="m-0 text-[13px] font-semibold">Agent Connections</h3>
        <button
          className="flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-fg-secondary text-base cursor-pointer transition-colors duration-150 hover:bg-error hover:text-user-fg"
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {agents.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-fg-muted text-xs">
            No agents configured yet.
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.agentId}
              className="flex flex-col border-b border-border p-3 gap-2"
            >
              <div className="flex items-center gap-2">
                {/* Left: status + info */}
                <span
                  className="shrink-0 text-[14px] leading-none"
                  style={{ color: getStatusColor(agent.state) }}
                  title={agent.state}
                >
                  {getStatusIcon(agent.state)}
                </span>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-fg-primary text-xs font-semibold truncate">
                    {agent.agentId}
                  </span>
                  <span className="text-fg-muted text-[11px] font-mono truncate">
                    {agent.command}
                  </span>
                </div>

                {/* Right: session count + actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-fg-muted text-[10px]">
                    {agent.sessionCount}{" "}
                    {agent.sessionCount === 1 ? "session" : "sessions"}
                  </span>

                  {canConnect(agent.state) && (
                    <button
                      className="px-2 py-[2px] border border-accent rounded bg-accent text-user-fg text-[11px] cursor-pointer whitespace-nowrap hover:bg-[color-mix(in_srgb,var(--accent)_80%,white)]"
                      onClick={() => handleConnect(agent.agentId)}
                      title="Connect"
                    >
                      Connect
                    </button>
                  )}

                  {canDisconnect(agent.state) && (
                    <button
                      className="px-2 py-[2px] border border-border rounded bg-bg-input text-fg-primary text-[11px] cursor-pointer whitespace-nowrap hover:bg-accent-hover"
                      onClick={() => handleDisconnect(agent.agentId)}
                      title="Disconnect"
                    >
                      Disconnect
                    </button>
                  )}

                  <button
                    className="inline-flex items-center justify-center w-5 h-5 p-0 border border-transparent rounded bg-transparent text-fg-muted text-xs cursor-pointer transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)] hover:text-error"
                    onClick={() => handleRemoveAgent(agent.agentId)}
                    title="Remove agent"
                  >
                    ×
                  </button>
                </div>
              </div>

              {agent.lastError && (
                <div className="text-[11px] text-error bg-[color-mix(in_srgb,var(--error)_10%,transparent)] border-l-2 border-l-[var(--error)] rounded p-1.5">
                  {agent.lastError}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add Agent form */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="text-[11px] font-semibold text-fg-secondary mb-2">
          Add Agent
        </div>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            className="w-full px-2 py-1 border border-border rounded bg-bg-input text-fg-primary text-xs outline-none focus:border-accent"
            placeholder="Agent name"
            value={newAgentId}
            onChange={(e) => setNewAgentId(e.target.value)}
          />
          <input
            type="text"
            className="w-full px-2 py-1 border border-border rounded bg-bg-input text-fg-primary text-xs outline-none focus:border-accent"
            placeholder="Command (e.g. npx)"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
          />
          <input
            type="text"
            className="w-full px-2 py-1 border border-border rounded bg-bg-input text-fg-primary text-xs outline-none focus:border-accent"
            placeholder="Arguments (space-separated, optional)"
            value={newArgs}
            onChange={(e) => setNewArgs(e.target.value)}
          />
          <button
            className="self-start px-3 py-1 border border-accent rounded bg-accent text-user-fg text-xs cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_80%,white)] disabled:opacity-40 disabled:cursor-not-allowed"
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
