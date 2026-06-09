import * as vscode from "vscode";
import type { SessionOrchestrator } from "../session/orchestrator";

type TreeItemKind = "agent" | "session";

export interface AgentTreeItem extends vscode.TreeItem {
  kind: "item";
  itemKind: TreeItemKind;
  agentId: string;
  sessionId?: string;
}

export interface TreeProvider {
  readonly onDidChangeTreeData: vscode.Event<AgentTreeItem | undefined>;
  refresh(): void;
  getTreeItem(element: AgentTreeItem): vscode.TreeItem;
  getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]>;
}

export function createAgentTreeProvider(
  orchestrator: SessionOrchestrator
): TreeProvider {
  const emitter = new vscode.EventEmitter<AgentTreeItem | undefined>();

  return {
    onDidChangeTreeData: emitter.event,
    refresh() {
      emitter.fire(undefined);
    },
    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
      return element;
    },
    async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
      if (!element) {
        const agents = orchestrator.getAllAgents();
        if (agents.length === 0) {
          const item = new vscode.TreeItem("No agent connected") as AgentTreeItem;
          item.itemKind = "agent";
          item.agentId = "";
          item.iconPath = new vscode.ThemeIcon("circle-slash");
          item.contextValue = "acp.agent";
          return [item];
        }
        return agents.map((status): AgentTreeItem => {
          const item = new vscode.TreeItem(
            status.agentId,
            vscode.TreeItemCollapsibleState.Expanded
          ) as AgentTreeItem;
          item.itemKind = "agent";
          item.agentId = status.agentId;
          item.iconPath = new vscode.ThemeIcon(
            status.state === "busy" ? "loading~spin" :
            status.state === "idle" ? "hubot" :
            "circle-slash"
          );
          item.contextValue = "acp.agent";
          item.description = status.state;
          return item;
        });
      }

      if (element.itemKind === "agent") {
        const sessions = orchestrator.getSessionsForAgent(element.agentId);
        return sessions.map((s): AgentTreeItem => {
          const item = new vscode.TreeItem(
            s.title,
            vscode.TreeItemCollapsibleState.None
          ) as AgentTreeItem;
          item.itemKind = "session";
          item.agentId = element.agentId;
          item.sessionId = s.sessionId;
          const isActive = orchestrator.getActiveSessionId(element.agentId) === s.sessionId;
          item.iconPath = new vscode.ThemeIcon(
            s.status === "running" ? "loading~spin" :
            isActive ? "circle-filled" : "circle-outline"
          );
          item.contextValue = "acp.session";
          item.description = s.status;
          return item;
        });
      }

      return [];
    },
  };
}
