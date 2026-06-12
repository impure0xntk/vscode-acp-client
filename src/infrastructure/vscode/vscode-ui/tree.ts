import type { SessionOrchestrator } from "../../../application/orchestrator";
import type { UIAPI } from "../../../platform/ui";
import type { EventEmitter, Event } from "../../../platform/types";

type TreeItemKind = "agent" | "session";

export interface AgentTreeItem {
  kind: "item";
  itemKind: TreeItemKind;
  agentId: string;
  sessionId?: string;
  label: string;
  collapsibleState: "none" | "collapsed" | "expanded";
  iconPath?: string;
  contextValue?: string;
  description?: string;
}

export interface TreeProvider {
  readonly onDidChangeTreeData: Event<AgentTreeItem | undefined>;
  refresh(): void;
  getTreeItem(element: AgentTreeItem): AgentTreeItem;
  getChildren(element?: AgentTreeItem): AgentTreeItem[] | Promise<AgentTreeItem[]>;
}

export function createAgentTreeProvider(
  orchestrator: SessionOrchestrator,
  ui: UIAPI
): TreeProvider {
  const emitter = ui.createEventEmitter<AgentTreeItem | undefined>();

  return {
    onDidChangeTreeData: emitter.event,
    refresh() {
      emitter.fire(undefined);
    },
    getTreeItem(element: AgentTreeItem): AgentTreeItem {
      return element;
    },
    async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
      if (!element) {
        const agents = orchestrator.getAllAgents();
        if (agents.length === 0) {
          return [{
            kind: "item",
            itemKind: "agent",
            agentId: "",
            label: "No agent connected",
            collapsibleState: "none",
            iconPath: "circle-slash",
            contextValue: "acp.agent",
          }];
        }
        return agents.map((status): AgentTreeItem => ({
          kind: "item",
          itemKind: "agent",
          agentId: status.agentId,
          label: status.agentId,
          collapsibleState: "expanded",
          iconPath: status.state === "busy" ? "loading~spin" :
                    status.state === "idle" ? "hubot" :
                    "circle-slash",
          contextValue: "acp.agent",
          description: status.state,
        }));
      }

      if (element.itemKind === "agent") {
        const sessions = orchestrator.getSessionsForAgent(element.agentId);
        return sessions.map((s): AgentTreeItem => {
          const isActive = orchestrator.getActiveSessionId(element.agentId) === s.sessionId;
          return {
            kind: "item",
            itemKind: "session",
            agentId: element.agentId,
            sessionId: s.sessionId,
            label: s.title,
            collapsibleState: "none",
            iconPath: s.status === "running" ? "loading~spin" :
                      isActive ? "circle-filled" : "circle-outline",
            contextValue: "acp.session",
            description: s.status,
          };
        });
      }

      return [];
    },
  };
}
