import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
} from "react";
import type {
  CommunicationMode,
  ContextAttachment,
  QueuedPrompt,
  QueuedPromptMode,
  SelectedTeam,
  SendTarget,
  SuggestionItem,
  TriggerType,
} from "../../types";
import type { SlashCommand, SessionTabState } from "../../store/sessionStore";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import { useMessageStore } from "../../store/messageStore";
import { useMeshStore } from "../../store/meshStore";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { getLogger } from "../../lib/logger";
import { sessionColorForKey } from "../../shared/sessionColor";
import { collectTurns } from "../../lib/sessionTurns";

const log = getLogger("webview.Composer");
import { ContextBar } from "./ContextBar";
import { ContextPicker } from "./ContextPicker";
import { ContextPreview } from "./ContextPreview";
import { ActiveSessionIndicator } from "./ActiveSessionIndicator";
import type { FileCandidate } from "./ContextPicker";
import { Icon } from "../../lib/icons";
import {
  useTriggerPicker,
  type TriggerState,
  type SelectOutput,
} from "../../hooks/useTriggerPicker";

const MAX_HISTORY = 50;

const MODE_META: Record<
  CommunicationMode,
  { label: string; icon: string; description: string }
> = {
  direct: {
    label: "Direct",
    icon: "arrow-right",
    description: "1:1 direct message",
  },
  fanout: {
    label: "Fanout",
    icon: "git-branch",
    description: "1:N broadcast to all targets",
  },
  supervisor: {
    label: "Supervisor",
    icon: "crown",
    description: "Lead decomposes task, assigns workers",
  },
  pipeline: {
    label: "Pipeline",
    icon: "arrow-down",
    description: "Sequential A→B→C processing",
  },
  p2P: {
    label: "P2P",
    icon: "repeat",
    description: "Autonomous agent-to-agent",
  },
};

export interface ComposerProps {
  onSend: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[],
    mode?: CommunicationMode | null,
    teamId?: string,
    queueMode?: QueuedPromptMode
  ) => void;
  onCancel: (targets?: SendTarget[]) => void;
  onNewSession?: () => void;
  onSwitchSession?: (agentId: string, sessionId: string) => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  disabled?: boolean;
  status?:
    | "idle"
    | "running"
    | "cancelling"
    | "completed"
    | "error"
    | "cancelled";
  fetchFiles: (query: string, cwd?: string) => Promise<FileCandidate[]>;
  resolveFile: (path: string) => Promise<ContextAttachment>;
  resolveSelection: () => Promise<ContextAttachment | null>;
  resolveDiff: () => Promise<ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<ContextAttachment>;
  /** Resolve a previous turn's final output into a context attachment.
   *  `ref` is `${agentId}::${sessionId}::${turnIndex}`. */
  resolveOutput: (ref: string) => Promise<ContextAttachment | null>;
  availableCommands?: SlashCommand[];
  /** Queued prompts for the active session */
  queue?: QueuedPrompt[];
  /** Send a queued prompt immediately (bypassing queue) */
  onSendNow?: (promptId: string) => void;
  /** Remove a single queued prompt */
  onRemoveQueueItem?: (promptId: string) => void;
  /** Clear all queued prompts */
  onClearQueue?: () => void;
  /** Attach a diff attachment (from FileEditSummary) */
  onAttachDiff?: (attachment: ContextAttachment) => void;
  /** Send with an explicit queue mode (stack/inject) — used for running-session routing. Defaults to undefined (immediate). */
  onSendMode?: (
    text: string,
    attachments: ContextAttachment[],
  ) => void;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "No response";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function buildSessionSuggestions(
  tabs: SessionTabState[],
  query: string
): SuggestionItem[] {
  const sessionStore = useSessionStore.getState();
  const sessionInfoMap = sessionStore.sessionInfoMap;
  const connectedAgents = sessionStore.connectedAgents;

  const items: SuggestionItem[] = tabs.map((tab) => {
    const key = `${tab.agentId}:${tab.sessionId}`;
    const info = sessionInfoMap[key];
    const sessionColor = info?.sessionColor ?? sessionColorForKey(key);

    const timeStr = relativeTime(info?.lastResponseAt ?? null);
    // Start without preview — will be enriched asynchronously
    const detail = `${tab.agentId} · ${timeStr}`;

    return {
      id: `session:${tab.agentId}:${tab.sessionId}`,
      kind: "session" as const,
      label: tab.title ?? tab.sessionId.slice(0, 8),
      value: `${tab.agentId}:${tab.sessionId}`,
      detail,
      icon: "chat",
      agentId: tab.agentId,
      sessionId: tab.sessionId,
      status: info?.status ?? "idle",
      sessionColor,
      tokenUsage: info?.tokenUsage,
      contextWindowMax: info?.contextWindowMax,
    };
  });

  if (!query) return items;

  const q = query.toLowerCase();
  return items.filter(
    (s) =>
      s.label.toLowerCase().includes(q) ||
      s.detail?.toLowerCase().includes(q) ||
      s.value.toLowerCase().includes(q)
  );
}

/**
 * Asynchronously enrich session suggestions with last agent message preview.
 * Applies in-place (mutates `detail` on each item) so React re-renders via updateSuggestions.
 */
export type SuggestionUpdater = (items: SuggestionItem[]) => void;

export function enrichSessionSuggestionsAsync(
  items: SuggestionItem[],
  updateSuggestions: SuggestionUpdater
): void {
  // Defer to next microtask so picker renders immediately
  queueMicrotask(() => {
    const perSession = useMessageStore.getState().perSession;
    let changed = false;

    for (const item of items) {
      if (item.kind !== "session" || !item.agentId || !item.sessionId) continue;
      const key = `${item.agentId}:${item.sessionId}`;
      const messages = perSession[key] ?? [];
      const lastAgentMsg = [...messages]
        .reverse()
        .find((m) => m.role === "agent");
      const preview = lastAgentMsg
        ? lastAgentMsg.content.replace(/\s+/g, " ").trim().slice(0, 60)
        : null;

      if (preview) {
        const sessionStore = useSessionStore.getState();
        const info = sessionStore.sessionInfoMap[key];
        const timeStr = relativeTime(info?.lastResponseAt ?? null);
        const newDetail = `${item.agentId} · ${timeStr} · ${preview}`;
        if (item.detail !== newDetail) {
          item.detail = newDetail;
          changed = true;
        }
      }
    }

    if (changed) {
      updateSuggestions([...items]);
    }
  });
}

/** Imperative handle exposed by Composer via forwardRef */
export interface ComposerHandle {
  focusTextarea: () => void;
}

export const Composer = React.forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      onSend,
      onCancel,
      onNewSession,
      onSwitchSession,
      onRenameSession,
      disabled = false,
      status = "idle",
      fetchFiles,
      resolveFile,
      resolveSelection,
      resolveDiff,
      fetchSymbols,
      resolveSymbol,
      resolveOutput,
      availableCommands = [],
      queue = [],
      onSendNow,
      onRemoveQueueItem,
      onClearQueue,
      onAttachDiff,
      onSendMode,
    },
    ref
  ): React.ReactElement {
    // Read tabs imperatively — getTabs() returns a new array each call,
    // which would cause an infinite loop via useSyncExternalStore.
    const tabs = useSessionStore.getState().getTabs();
    const connectedAgents = useSessionStore((s) => s.connectedAgents);

    const [text, setText] = useState("");
    const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
    // Previewed attachment id — clicking a chip toggles its content preview.
    // Only attachments that contribute tokens (tokenCount > 0) are previewable.
    const [previewAttachmentId, setPreviewAttachmentId] = useState<
      string | null
    >(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const historyRef = useRef<string[]>([]);
    const historyIdxRef = useRef(-1);
    const inputBeforeNavRef = useRef("");

    useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.attachment) {
          setAttachments((prev) => [...prev, detail.attachment]);
        }
      };
      window.addEventListener("acp:attachDiff", handler);
      window.addEventListener("acp:attachExternalFile", handler);
      // Editor-driven attach (acp.attachFile / acp.attachSelection /
      // acp.attachDiff commands) — inject into Composer attachments.
      window.addEventListener("acp:attachContext", handler);
      return () => {
        window.removeEventListener("acp:attachDiff", handler);
        window.removeEventListener("acp:attachExternalFile", handler);
        window.removeEventListener("acp:attachContext", handler);
      };
    }, []);

    // Pre-fill the Composer for a code review: the active session's
    // aggregated "Files changed" diff attachment plus the configured review
    // prompt. Triggered by the `acp.reviewChanges` command / "Files changed"
    // review button so the user can forward the changes to another session.
    useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          attachment?: ContextAttachment;
          prompt?: string;
        };
        if (detail.attachment) {
          setAttachments((prev) => [
            ...prev.filter((a) => a.id !== detail.attachment!.id),
            detail.attachment!,
          ]);
        }
        if (detail.prompt) {
          setText(detail.prompt);
        }
        requestAnimationFrame(() => textareaRef.current?.focus());
      };
      window.addEventListener("acp:prepareReview", handler);
      return () => window.removeEventListener("acp:prepareReview", handler);
    }, []);

    const resetHeight = useCallback(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }, []);

    const autoResizeHeight = useCallback(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
      }
    }, []);

    const resetPickerImpl = useRef<() => void>(() => {});
    const resetPicker = useCallback(() => {
      resetPickerImpl.current();
    }, []);

    // Expose imperative focus method for parent components (e.g. MeshPanel Plan button)
    React.useImperativeHandle(ref, () => ({
      focusTextarea: () => {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      },
    }));

    const sendTargets = useMeshStore((s) => s.sendTargets);
    const addSendTarget = useMeshStore((s) => s.addSendTarget);
    const removeSendTarget = useMeshStore((s) => s.removeSendTarget);
    const clearSendTargets = useMeshStore((s) => s.clearSendTargets);

    const selectedTeam = useMeshStore((s) => s.selectedTeam);
    const setSelectedTeam = useMeshStore((s) => s.setSelectedTeam);

    const communicationMode = useMeshStore((s) => s.communicationMode);
    const setCommunicationMode = useMeshStore((s) => s.setCommunicationMode);

    // Track multi-@ mode: true when at least one @ target is selected
    const isMultiMode = sendTargets.length > 0;

    // Compute targets for cancel: when sendTargets are selected (multi-@ mode),
    // use those; the active session fallback is in AppContainer.cancelTurn
    const cancelTargets = sendTargets.length > 0 ? sendTargets : undefined;

    const buildTeamSuggestions = useCallback(
      (query: string): SuggestionItem[] => {
        const teams = useMeshStore.getState().teams;
        const items: SuggestionItem[] = teams.map((team) => ({
          id: `team:${team.id}`,
          kind: "team" as const,
          label: team.name,
          value: team.id,
          detail: `${team.members.length} members`,
          icon: "users",
        }));
        if (!query) return items;
        const q = query.toLowerCase();
        return items.filter(
          (t) =>
            t.label.toLowerCase().includes(q) ||
            t.value.toLowerCase().includes(q)
        );
      },
      []
    );

    const fetchSuggestions = useCallback(
      async (
        trigger: TriggerType,
        query: string,
        subTrigger?: "symbol" | "file" | "switch" | "team" | "output" | "turn"
      ): Promise<SuggestionItem[]> => {
        if (trigger === "/") {
          const agentItems: SuggestionItem[] = availableCommands.map((cmd) => ({
            id: `agent:${cmd.name}`,
            kind: "command" as const,
            label: `/${cmd.name}`,
            value: `/${cmd.name}`,
            detail: cmd.description ?? undefined,
            icon: "zap",
          }));
          const meshItems: SuggestionItem[] = [
            {
              id: "mesh:plan",
              kind: "action",
              label: "/mesh plan",
              value: "meshPlan",
              detail: "Request a plan from the Planner",
              icon: "list-tree",
            },
            {
              id: "mesh:fanout",
              kind: "action",
              label: "/mesh fanout",
              value: "meshFanout",
              detail: "1:N broadcast — select @targets then send",
              icon: "git-branch",
            },
            {
              id: "mesh:supervisor",
              kind: "action",
              label: "/mesh supervisor",
              value: "meshSupervisor",
              detail: "Lead/worker pattern — select lead @target then send",
              icon: "crown",
            },
            {
              id: "mesh:pipeline",
              kind: "action",
              label: "/mesh pipeline",
              value: "meshPipeline",
              detail: "Sequential A→B→C — select @targets in order",
              icon: "arrow-down",
            },
            {
              id: "mesh:status",
              kind: "action",
              label: "/mesh status",
              value: "meshStatus",
              detail: "Toggle Mesh Panel",
              icon: "layout-dashboard",
            },
            {
              id: "mesh:cancel",
              kind: "action",
              label: "/mesh cancel",
              value: "meshCancel",
              detail: "Cancel current plan execution",
              icon: "circle-slash",
            },
          ];
          const allItems = [...agentItems, ...meshItems];
          if (query) {
            const q = query.toLowerCase();
            return allItems.filter(
              (c) =>
                c.label.toLowerCase().includes(q) ||
                (c.detail ?? "").toLowerCase().includes(q)
            );
          }
          return allItems;
        }

        if (trigger === "@") {
          if (subTrigger === "team") {
            return buildTeamSuggestions(query);
          }
          return buildSessionSuggestions(tabs, query);
        }

        if (subTrigger === "symbol") {
          return fetchSymbols(query);
        }

        if (subTrigger === "file") {
          // When multi-@ targets are selected, fetch files from each target's
          // cwd in parallel and merge results.  Single-target and no-target
          // cases use the active session's cwd (or undefined).
          const sessionInfoMap = useSessionStore.getState().sessionInfoMap;
          const tabTitles = useSessionStore.getState().tabTitles;
          const cwds: string[] = [];
          // Build a map: cwd → set of session title labels for display
          const cwdSources = new Map<string, Set<string>>();
          if (sendTargets.length > 0) {
            for (const t of sendTargets) {
              const info = sessionInfoMap[`${t.agentId}:${t.sessionId}`];
              if (info?.cwd) {
                if (!cwds.includes(info.cwd)) cwds.push(info.cwd);
                const key = `${t.agentId}:${t.sessionId}`;
                const title = tabTitles[key] ?? t.label;
                if (!cwdSources.has(info.cwd))
                  cwdSources.set(info.cwd, new Set());
                cwdSources.get(info.cwd)!.add(title);
              }
            }
          } else {
            // Fallback: active session cwd
            const activeKey = useSessionStore.getState().activeSessionKey;
            if (activeKey) {
              const info = sessionInfoMap[activeKey];
              if (info?.cwd) {
                cwds.push(info.cwd);
                const title = tabTitles[activeKey] ?? info.sessionId;
                cwdSources.set(info.cwd, new Set([title]));
              }
            }
          }

          // Track how many unique cwds we're fetching from
          const multiCwd = cwds.length > 1;

          const fileArrays = await Promise.all(
            cwds.length > 0
              ? cwds.map((cwd) => fetchFiles(query, cwd))
              : [fetchFiles(query)]
          );
          // Merge and deduplicate by relativePath, collecting all source cwds per file
          // Key insight: different sessions with the SAME cwd can also share files,
          // so we track which unique cwds a file appeared in AND collect all session
          // titles across all matching cwds.
          const seen = new Map<
            string,
            FileCandidate & { sourceCwds: string[] }
          >();
          for (let i = 0; i < fileArrays.length; i++) {
            const cwd = cwds[i];
            for (const f of fileArrays[i]) {
              const existing = seen.get(f.relativePath);
              if (existing) {
                if (!existing.sourceCwds.includes(cwd))
                  existing.sourceCwds.push(cwd);
              } else {
                seen.set(f.relativePath, { ...f, sourceCwds: [cwd] });
              }
            }
          }
          const merged = Array.from(seen.values());
          const fileItems: SuggestionItem[] = merged.map((f) => {
            // When multiple cwds are involved, collect all session titles from all
            // matching cwds and show them comma-separated, e.g. "S1, S2 : /tmp/test"
            let detail = f.relativePath;
            if (multiCwd) {
              const titles: string[] = [];
              for (const cwd of f.sourceCwds) {
                const srcs = cwdSources.get(cwd);
                if (srcs) {
                  for (const t of srcs) titles.push(t);
                }
              }
              if (titles.length > 0) {
                detail = `${titles.join(", ")} : ${f.relativePath}`;
              }
            }
            return {
              id: `file:${f.relativePath}`,
              kind: "file" as const,
              label: f.name,
              value: f.absolutePath ?? f.relativePath,
              detail,
              icon: "file",
            };
          });
          fileItems.push(
            {
              id: "special:selection",
              kind: "selection",
              label: "#selection — Attach current selection",
              value: "__selection__",
              icon: "selection",
            },
            {
              id: "special:diff",
              kind: "diff",
              label: "#diff — Attach working tree diff",
              value: "__diff__",
              icon: "diff-single",
            }
          );
          return fileItems;
        }

        if (subTrigger === "switch") {
          return buildSessionSuggestions(tabs, query);
        }

        if (subTrigger === "output" || subTrigger === "turn") {
          const perSession = useMessageStore.getState().perSession;
          const turns = collectTurns(perSession);
          const q = query.toLowerCase();
          const filtered =
            q.length > 0
              ? turns.filter(
                  (t) =>
                    t.sessionTitle.toLowerCase().includes(q) ||
                    t.userPrompt.toLowerCase().includes(q) ||
                    t.output.toLowerCase().includes(q)
                )
              : turns;
          return filtered.map((t) => ({
            id: `turn:${t.agentId}::${t.sessionId}::${t.turnIndex}`,
            kind: "turn" as const,
            label: `${t.sessionTitle} · ${t.userPrompt.slice(0, 40)}${t.userPrompt.length > 40 ? "…" : ""}`,
            value: `${t.agentId}::${t.sessionId}::${t.turnIndex}`,
            detail: t.output.replace(/\s+/g, " ").trim().slice(0, 60),
            icon: "output",
          }));
        }

        // subTrigger === undefined → "# " — show subcommand completions
        const subCommands: SuggestionItem[] = [
          {
            id: "action:new",
            kind: "action",
            label: "#new",
            value: "new",
            detail: "Start a new session",
            icon: "sparkle",
          },
          {
            id: "action:reset",
            kind: "action",
            label: "#reset",
            value: "reset",
            detail: "Reset current session",
            icon: "sync",
          },
          {
            id: "sub:file",
            kind: "file",
            label: "file",
            value: "file",
            detail: "Attach a file",
            icon: "file",
          },
          {
            id: "sub:symbol",
            kind: "symbol",
            label: "symbol",
            value: "symbol",
            detail: "Attach a symbol",
            icon: "symbol-class",
          },
          {
            id: "sub:selection",
            kind: "selection",
            label: "selection",
            value: "__selection__",
            detail: "Attach current selection",
            icon: "selection",
          },
          {
            id: "sub:diff",
            kind: "diff",
            label: "diff",
            value: "__diff__",
            detail: "Attach working tree diff",
            icon: "diff-single",
          },
          {
            id: "sub:output",
            kind: "turn",
            label: "output",
            value: "output",
            detail: "Attach a previous turn's final output",
            icon: "output",
          },
          {
            id: "sub:turn",
            kind: "turn",
            label: "turn",
            value: "turn",
            detail: "Attach a previous turn's final output",
            icon: "output",
          },
          {
            id: "sub:switch",
            kind: "action",
            label: "switch",
            value: "switch",
            detail: "Switch to another session",
            icon: "arrow-right-left",
          },
          {
            id: "action:rename",
            kind: "action",
            label: "rename",
            value: "rename",
            detail: "Rename current session",
            icon: "pencil",
          },
        ];
        if (query) {
          const q = query.toLowerCase();
          return subCommands.filter(
            (c) =>
              c.label.toLowerCase().includes(q) ||
              (c.detail ?? "").toLowerCase().includes(q)
          );
        }
        return subCommands;
      },
      [fetchFiles, fetchSymbols, tabs, availableCommands]
    );

    const resolveItem = useCallback(
      async (
        input: Parameters<typeof handleSelect>[0]
      ): Promise<SelectOutput> => {
        const { triggerState, item } = input;
        let newText = input.text;
        // Calculate consumed length based on trigger type and subTrigger
        let consumed: number;
        if (triggerState.trigger === "/") {
          consumed = 1 + triggerState.query.length;
        } else if (triggerState.trigger === "@") {
          if (triggerState.subTrigger) {
            // @team:query → @ + subTrigger + ":" + query
            consumed =
              1 +
              triggerState.subTrigger.length +
              1 +
              triggerState.query.length;
          } else {
            // @query → @ + query
            consumed = 1 + triggerState.query.length;
          }
        } else if (triggerState.subTrigger) {
          // #subTrigger query → # + subTrigger + " " + query
          consumed =
            1 +
            triggerState.subTrigger.length +
            (triggerState.query.length > 0 ? 1 + triggerState.query.length : 0);
        } else {
          // #query → # + query
          consumed = 1 + triggerState.query.length;
        }

        const before = newText.slice(0, triggerState.caretOffset);
        const after = newText.slice(triggerState.caretOffset + consumed);
        const space = after.startsWith(" ") ? "" : " ";

        if (item.kind === "file") {
          try {
            const attachment = await resolveFile(item.value);
            setAttachments((prev) => [...prev, attachment]);
          } catch {
            /* silently fail */
          }
          newText = before + after;
          setText(newText);
        } else if (item.kind === "selection") {
          try {
            const attachment = await resolveSelection();
            if (attachment) setAttachments((prev) => [...prev, attachment]);
          } catch {
            /* silently fail */
          }
          newText = before + after;
          setText(newText);
        } else if (item.kind === "diff") {
          try {
            const attachment = await resolveDiff();
            if (attachment) setAttachments((prev) => [...prev, attachment]);
          } catch {
            /* silently fail */
          }
          newText = before + after;
          setText(newText);
        } else if (item.kind === "turn") {
          try {
            const attachment = await resolveOutput(item.value);
            if (attachment) setAttachments((prev) => [...prev, attachment]);
          } catch {
            /* silently fail */
          }
          newText = before + after;
          setText(newText);
        } else if (item.kind === "command") {
          newText = before + item.value + space + after;
          setText(newText);
        } else if (item.kind === "action") {
          if (item.value === "new") {
            onNewSession?.();
          } else if (item.value === "rename") {
            // Trigger rename for the active session
            const activeKey = useSessionStore.getState().activeSessionKey;
            if (activeKey && onRenameSession) {
              const [agentId, sessionId] = activeKey.split(":");
              // We need to get the current title and prompt for a new one
              // For now, send a signal; the actual rename dialog is handled by the parent
              onRenameSession(agentId, sessionId, "");
            }
          } else if (item.value === "meshPlan") {
            // Activate supervisor mode with plan intent; user types request text then Enter
            setCommunicationMode("supervisor");
            clearSendTargets();
            // If a team is already selected, keep it; otherwise user picks via @team:
            newText = before + after;
            setText(newText);
            // Focus textarea so user can type plan request immediately
            requestAnimationFrame(() => textareaRef.current?.focus());
          } else if (item.value === "meshStatus") {
            getVsCodeApi().postMessage({ type: "mesh:togglePanel" });
          } else if (item.value === "meshCancel") {
            const currentPlan = useSessionStore.getState().currentPlan;
            if (currentPlan) {
              getVsCodeApi().postMessage({
                type: "plan.cancel",
                planId: currentPlan.id,
              });
            }
          } else if (
            item.value === "meshFanout" ||
            item.value === "meshSupervisor" ||
            item.value === "meshPipeline"
          ) {
            // Set communication mode — next @ picks become targets for this mode
            const modeMap: Record<string, CommunicationMode> = {
              meshFanout: "fanout",
              meshSupervisor: "supervisor",
              meshPipeline: "pipeline",
            };
            setCommunicationMode(modeMap[item.value]);
            // Clear any stale targets from a previous mode
            clearSendTargets();
          }
          newText = before + after;
          setText(newText);
        } else if (item.kind === "symbol") {
          try {
            const attachment = await resolveSymbol(item.value);
            setAttachments((prev) => [...prev, attachment]);
          } catch {
            /* silently fail */
          }
          newText = before + after;
          setText(newText);
        } else if (item.kind === "team") {
          // @team: picker — store selected team, remove @team:... from textarea
          const team = useMeshStore
            .getState()
            .teams.find((t) => t.id === item.value);
          if (team) {
            setSelectedTeam({
              id: team.id,
              name: team.name,
              leadAgentId: team.lead.agentId,
            });
          }
          newText = before + after;
          setText(newText);
        } else if (item.kind === "session") {
          if (triggerState.subTrigger === "switch") {
            onSwitchSession?.(item.agentId!, item.sessionId!);
            newText = "";
            setText(newText);
          } else {
            // Multi-@: add to send targets instead of replacing
            const sessionInfoMap = useSessionStore.getState().sessionInfoMap;
            const info = sessionInfoMap[`${item.agentId}:${item.sessionId}`];
            const target: SendTarget = {
              agentId: item.agentId!,
              sessionId: item.sessionId!,
              label: item.label,
              status: (info?.status as SendTarget["status"]) ?? "idle",
              sessionColor: item.sessionColor,
              tokenUsage: info?.tokenUsage,
              contextWindowMax: info?.contextWindowMax,
            };
            addSendTarget(target);

            // Remove @query from textarea — send target chip is shown below
            newText = before + after;
            setText(newText);

            requestAnimationFrame(() => {
              if (textareaRef.current) {
                const pos = before.length;
                textareaRef.current.selectionStart = pos;
                textareaRef.current.selectionEnd = pos;
                textareaRef.current.focus();
              }
            });
          }
        }

        return {
          text: newText,
          triggerState: {
            active: false,
            trigger: "#" as const,
            query: "",
            caretOffset: 0,
            multiMode:
              isMultiMode ||
              (item.kind === "session" && triggerState.subTrigger !== "switch"),
          },
        };
      },
      [
        resolveFile,
        resolveSelection,
        resolveDiff,
        resolveSymbol,
        resolveOutput,
        onNewSession,
        onSwitchSession,
        addSendTarget,
        isMultiMode,
      ]
    );

    const {
      triggerState,
      pickerIndex,
      setPickerIndex,
      handleChange: onTriggerChange,
      handleSelect,
      handleClose: onClosePicker,
      reset: resetPickerHook,
      pickerKeyDownRef,
      registerKeyHandler,
    } = useTriggerPicker({
      fetchSuggestions,
      resolveItem,
    });

    // Wire up the early-defined resetPicker callback to the hook's reset
    resetPickerImpl.current = resetPickerHook;

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        const caret = e.target.selectionStart ?? value.length;

        // In multi-mode, trigger @ picker each time @ is typed
        const multiTriggerState = isMultiMode
          ? { ...onTriggerChange(value, caret), multiMode: true }
          : onTriggerChange(value, caret);

        setPickerIndex(0);

        if (historyIdxRef.current !== -1) {
          historyIdxRef.current = -1;
          inputBeforeNavRef.current = "";
        }
        setText(value);
        autoResizeHeight();
      },
      [onTriggerChange, setPickerIndex, isMultiMode, autoResizeHeight]
    );

    const handleRemoveAttachment = useCallback((id: string) => {
      setAttachments((prev) => prev.filter((a) => a.id !== id));
      setPreviewAttachmentId((prev) => (prev === id ? null : prev));
    }, []);

    // Toggle the preview pane for an attachment. Only attachments that add
    // context tokens (tokenCount > 0) are previewable; others are ignored.
    const handlePreviewAttachment = useCallback(
      (attachment: ContextAttachment) => {
        if (attachment.tokenCount <= 0) return;
        setPreviewAttachmentId((prev) =>
          prev === attachment.id ? null : attachment.id
        );
      },
      []
    );

    /** Send immediately (bypass queue) — used by "send now" button on queued items */
    const handleSendNow = useCallback(
      (sendText: string, sendAttachments: ContextAttachment[]) => {
        const trimmed = sendText.trim();
        if ((!trimmed && sendAttachments.length === 0) || disabled) return;

        const targets = sendTargets.length > 0 ? sendTargets : undefined;
        log.info("sendNow", {
          textLen: trimmed.length,
          attachments: sendAttachments.length,
          targets: targets?.length ?? 0,
        });
        onSend(
          trimmed,
          sendAttachments,
          targets,
          communicationMode,
          selectedTeam?.id
        );

        clearSendTargets();
        setSelectedTeam(null);
        setCommunicationMode(null);
      },
      [
        disabled,
        onSend,
        sendTargets,
        clearSendTargets,
        selectedTeam,
        setSelectedTeam,
        communicationMode,
        setCommunicationMode,
      ]
    );

    // Queue mode selector: when a session is running, the user picks
    // stack/inject via hotkeys; this ref stores the pending mode so
    // handleSend can route correctly.
    const pendingQueueModeRef = useRef<
      "stack" | "inject" | null
    >(null);
    const usePendingQueueMode = (): "stack" | "inject" | null => {
      const m = pendingQueueModeRef.current;
      pendingQueueModeRef.current = null;
      return m;
    };

    const handleSend = useCallback(() => {
      const trimmed = text.trim();
      if ((trimmed || attachments.length > 0) && !disabled) {
        setPreviewAttachmentId(null);
        if (trimmed) {
          const h = historyRef.current;
          if (h.length === 0 || h[h.length - 1] !== trimmed) {
            h.push(trimmed);
            if (h.length > MAX_HISTORY) h.shift();
          }
        }
        historyIdxRef.current = -1;
        inputBeforeNavRef.current = "";

        // Supervisor mode + selectedTeam: route through mesh:plan
        if (communicationMode === "supervisor" && selectedTeam) {
          log.info("send:mesh:plan", {
            textLen: trimmed.length,
            teamId: selectedTeam.id,
          });
          // Display user message immediately in Supervisor view so it is
          // visible on the Supervisor side without waiting for the extension
          // host to echo it back through ACP (which may never happen for
          // planner agents that only return plan updates).
          const team = useMeshStore
            .getState()
            .teams.find((t) => t.id === selectedTeam.id);
          if (team) {
            const leadKey = sessionKeyOf(
              team.lead.agentId,
              team.lead.sessionId
            );
            const sessionStore = useSessionStore.getState();
            sessionStore.setActiveSession(leadKey);
            sessionStore.setSupervisorViewMode("focus");
            sessionStore.setSupervisorFocusSession(leadKey);
            const msgStore = useMessageStore.getState();
            msgStore.appendMessage(leadKey, {
              id: crypto.randomUUID(),
              role: "user",
              content: trimmed,
              timestamp: Date.now(),
              agentId: team.lead.agentId,
              sessionId: team.lead.sessionId,
              planMeta: { isPlanRequest: true, teamId: selectedTeam.id },
            });
            msgStore.appendMessage(leadKey, {
              id: `plan-indicator-${Date.now()}`,
              role: "system",
              content: "Planning...",
              timestamp: Date.now(),
              agentId: team.lead.agentId,
              sessionId: team.lead.sessionId,
              planMeta: {
                isPlanRequest: false,
                planStatus: "draft",
                teamId: selectedTeam.id,
              },
            });
            sessionStore.setIsPlanning(true, null);
          }
          getVsCodeApi().postMessage({
            type: "mesh:plan",
            text: trimmed,
            teamId: selectedTeam.id,
          });
          clearSendTargets();
          setSelectedTeam(null);
          setCommunicationMode(null);
          resetPicker();
          setText("");
          setAttachments([]);
          resetHeight();
          return;
        }

        const targets = sendTargets.length > 0 ? sendTargets : undefined;
        const queueMode = usePendingQueueMode();
        log.info("send", {
          textLen: trimmed.length,
          attachments: attachments.length,
          targets: targets?.length ?? 0,
          mode: communicationMode,
          teamId: selectedTeam?.id ?? null,
          queueMode: queueMode ?? "immediate",
        });
        if (queueMode && status === "running" && onSendMode) {
          // Route to queue (stack or inject) instead of sending immediately.
          onSendMode(trimmed, attachments);
        } else {
          onSend(
            trimmed,
            attachments,
            targets,
            communicationMode,
            selectedTeam?.id,
            queueMode ?? undefined
          );
        }

        clearSendTargets();
        setSelectedTeam(null);
        setCommunicationMode(null);
        setText("");
        setAttachments([]);
        resetHeight();
      }
    }, [
      text,
      attachments,
      disabled,
      onSend,
      onSendMode,
      sendTargets,
      onSwitchSession,
      clearSendTargets,
      selectedTeam,
      setSelectedTeam,
      resetHeight,
      resetPicker,
      communicationMode,
      setCommunicationMode,
      status,
    ]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Picker open: delegate ArrowUp/Down/Enter/Escape to ContextPicker
        if (triggerState.active && pickerKeyDownRef.current) {
          if (["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) {
            e.preventDefault();
            pickerKeyDownRef.current(e);
          }
          return;
        }

        // Picker closed: Enter sends the message
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (status === "running") {
            // Default running-session send = stack (enqueue after turn).
            pendingQueueModeRef.current = "stack";
          }
          handleSend();
          return;
        }

        // Running-session hotkeys
        if (status === "running") {
          if (e.altKey && e.key === "Enter") {
            e.preventDefault();
            pendingQueueModeRef.current = "stack";
            handleSend();
            return;
          }
          if (e.metaKey && e.shiftKey && e.key === "Enter") {
            e.preventDefault();
            pendingQueueModeRef.current = "inject";
            handleSend();
            return;
          }
        }

        // Picker closed: ArrowUp/Down navigates message history.
        // For multiline input, only navigate at the *boundary* of the textarea:
        //   ArrowUp   → cursor is on the first line (any column)
        //   ArrowDown → cursor is on the last line  (any column)
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          const textarea = textareaRef.current;
          if (textarea) {
            const { selectionStart, value } = textarea;
            const lines = value.split("\n");

            // Determine cursor line-index
            let offset = 0;
            let cursorLine = 0;
            for (let i = 0; i < lines.length; i++) {
              const next = offset + lines[i].length;
              if (selectionStart <= next) {
                cursorLine = i;
                break;
              }
              offset = next + 1; // skip the newline
            }

            if (e.key === "ArrowUp") {
              // Allow history nav only when on the first line
              if (cursorLine > 0) return;
            } else {
              // ArrowDown — allow history nav only on the last line
              if (cursorLine < lines.length - 1) return;
            }
          }
        }

        if (e.key === "ArrowUp") {
          const history = historyRef.current;
          if (history.length === 0) return;
          if (historyIdxRef.current === -1) {
            inputBeforeNavRef.current = text;
            historyIdxRef.current = history.length - 1;
            e.preventDefault();
            setText(history[historyIdxRef.current]);
          } else if (historyIdxRef.current > 0) {
            historyIdxRef.current--;
            e.preventDefault();
            setText(history[historyIdxRef.current]);
          }
          // Defer resize to after React commits the new text to the DOM
          requestAnimationFrame(() => autoResizeHeight());
          return;
        }

        if (e.key === "ArrowDown") {
          const history = historyRef.current;
          if (historyIdxRef.current === -1) return;
          if (historyIdxRef.current < history.length - 1) {
            historyIdxRef.current++;
            e.preventDefault();
            setText(history[historyIdxRef.current]);
          } else {
            e.preventDefault();
            setText(inputBeforeNavRef.current);
            historyIdxRef.current = -1;
            inputBeforeNavRef.current = "";
          }
          requestAnimationFrame(() => autoResizeHeight());
          return;
        }
      },
      [
        handleSend,
        text,
        autoResizeHeight,
        triggerState.active,
        pickerKeyDownRef,
      ]
    );

    const placeholder = disabled
      ? "Connect to an agent first\u2026"
      : "Message (Enter to send, Shift+Enter for newline, # file / command, @ session)";

    return (
      <div className="composer flex-shrink-0 px-3 pt-1.5 pb-2">
        {/* Active session indicator — always shows where a plain message
            lands, so the user never has to guess which session is targeted.
            Hidden when multi-@ targets are selected (the ContextBar's
            SendTargetChips already enumerate them). */}
        <ActiveSessionIndicator
          activeSessionKey={useSessionStore.getState().activeSessionKey}
          sendTargets={sendTargets}
          disabled={disabled}
          onClick={() => {
            const key = useSessionStore.getState().activeSessionKey;
            if (!key) return;
            const [agentId, sessionId] = key.split(":");
            onSwitchSession?.(agentId, sessionId);
          }}
        />
        <ContextBar
          attachments={attachments}
          onRemove={handleRemoveAttachment}
          sendTargets={sendTargets}
          onRemoveSendTarget={removeSendTarget}
          connectedAgents={connectedAgents}
          selectedTeam={selectedTeam}
          onRemoveSelectedTeam={() => setSelectedTeam(null)}
          onPreviewAttachment={handlePreviewAttachment}
          previewingAttachmentId={previewAttachmentId}
        />

        {/* Attachment preview — shown above the input when a token-bearing
            chip is clicked. Lets the user inspect exactly what context will
            be injected into the prompt before sending. */}
        {(() => {
          const att = attachments.find((a) => a.id === previewAttachmentId);
          if (!att || att.tokenCount <= 0) return null;
          return (
            <ContextPreview
              attachment={att}
              onClose={() => setPreviewAttachmentId(null)}
            />
          );
        })()}

        {/* Mesh mode badge — shown when /mesh fanout|supervisor|pipeline is active */}
        {communicationMode && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-secondary border border-border text-xs mb-1">
            <Icon name={MODE_META[communicationMode].icon} size="sm" />
            <span className="text-fg-secondary font-medium">
              {MODE_META[communicationMode].label}
            </span>
            <button
              className="ml-auto flex items-center justify-center w-4 h-4 rounded bg-transparent text-fg-muted hover:bg-error hover:text-user-fg cursor-pointer border-none text-xs"
              onClick={() => setCommunicationMode(null)}
              title="Clear mode"
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
        )}

        {/* Queue panel — shown when there are queued messages */}
        {queue.length > 0 && (
          <div className="bg-bg-secondary border border-border rounded-md mb-1 overflow-hidden">
            <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]">
              <span className="text-[10px] font-semibold text-fg-secondary font-mono uppercase tracking-wider">
                {queue.length} queued message{queue.length !== 1 ? "s" : ""}
              </span>
              {onClearQueue && (
                <button
                  className="inline-flex items-center justify-center px-1.5 py-px rounded-[3px] bg-transparent text-fg-muted text-[10px] cursor-pointer border border-transparent hover:bg-error hover:text-user-fg hover:border-error transition-all"
                  onClick={onClearQueue}
                  title="Clear all queued messages"
                  aria-label="Clear all queued messages"
                >
                  Clear all
                </button>
              )}
            </div>
            <ul className="list-none m-0 p-0 max-h-[120px] overflow-y-auto">
              {queue.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-1 px-2 py-[3px] border-b border-[color-mix(in_srgb,var(--border)_30%,transparent)] last:border-b-0"
                >
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <span
                      className="text-[11px] text-fg-secondary whitespace-nowrap overflow-hidden text-ellipsis block"
                      title={entry.text}
                    >
                      {entry.text.length > 80
                        ? entry.text.slice(0, 80) + "\u2026"
                        : entry.text}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <span
                      className={`text-[9px] font-semibold uppercase px-1 rounded ${
                        entry.mode === "inject"
                          ? "bg-accent text-user-fg"
                          : "bg-bg-tertiary text-fg-muted"
                      }`}
                      title={entry.mode === "inject" ? "Inject (interrupt at boundary)" : "Stack (enqueue after turn)"}
                    >
                      {entry.mode === "inject" ? "INJ" : "STK"}
                    </span>
                    {onSendNow && entry.status === "pending" && (
                      <button
                        className="inline-flex items-center justify-center w-[18px] h-[18px] p-0 rounded-[3px] bg-transparent text-fg-muted text-[10px] cursor-pointer border-none hover:bg-accent hover:text-user-fg transition-all flex-shrink-0"
                        onClick={() => onSendNow(entry.id)}
                        title="Send now (bypass queue)"
                        aria-label="Send now"
                      >
                        ↑
                      </button>
                    )}
                    {onRemoveQueueItem && entry.status === "pending" && (
                      <button
                        className="inline-flex items-center justify-center w-[18px] h-[18px] p-0 rounded-[3px] bg-transparent text-fg-muted text-[10px] cursor-pointer border-none hover:bg-error hover:text-user-fg transition-all flex-shrink-0"
                        onClick={() => onRemoveQueueItem(entry.id)}
                        title="Remove from queue"
                        aria-label="Remove from queue"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {triggerState.active && (
          <ContextPicker
            trigger={triggerState.trigger}
            subTrigger={triggerState.subTrigger}
            query={triggerState.query}
            onSelect={(item) => handleSelect({ text, triggerState, item })}
            onClose={onClosePicker}
            fetchItems={fetchSuggestions}
            selectedIndex={pickerIndex}
            onSelectedIndexChange={setPickerIndex}
            registerKeyHandler={registerKeyHandler}
            onItemsFetched={(items, setItems) => {
              const isSessionTrigger =
                (triggerState.trigger === "@" &&
                  triggerState.subTrigger !== "team") ||
                (triggerState.trigger === "#" &&
                  triggerState.subTrigger === "switch");
              if (isSessionTrigger) {
                enrichSessionSuggestionsAsync(items, setItems);
              }
            }}
          />
        )}
        <div className="flex items-end gap-2 bg-bg-input border border-transparent rounded-lg px-2.5 py-1 focus-within:border-accent">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent border-none outline-none font-ui text-fg-primary text-[13px] leading-[1.5] resize-none max-h-[160px] min-h-[20px] placeholder:text-fg-muted"
          />
          <button
            className="bg-transparent border-none cursor-pointer text-sm w-6 h-6 rounded flex-shrink-0 flex items-center justify-center p-0 leading-none text-accent hover:bg-accent-hover disabled:text-fg-muted disabled:cursor-not-allowed"
            onClick={() =>
              getVsCodeApi().postMessage({ type: "attachExternalFile" })
            }
            disabled={disabled}
            title="Attach file (any location, including outside the workspace)"
            aria-label="Attach external file"
          >
            <Icon name="paperclip" size="sm" />
          </button>
          {status === "running" || status === "cancelling" ? (
            <>
              <button
                className="bg-transparent border-none cursor-pointer text-sm w-6 h-6 rounded flex-shrink-0 flex items-center justify-center p-0 leading-none text-fg-secondary hover:text-accent"
                onClick={() => {
                  pendingQueueModeRef.current = "stack";
                  handleSend();
                }}
                disabled={disabled || (!text.trim() && attachments.length === 0)}
                title="Stack — enqueue after current turn (⌥+Enter)"
                aria-label="Stack message"
              >
                ▤
              </button>
              <button
                className="bg-transparent border-none cursor-pointer text-sm w-6 h-6 rounded flex-shrink-0 flex items-center justify-center p-0 leading-none text-fg-secondary hover:text-accent"
                onClick={() => {
                  pendingQueueModeRef.current = "inject";
                  handleSend();
                }}
                disabled={disabled || (!text.trim() && attachments.length === 0)}
                title="Inject — interrupt at next boundary (⌘+Shift+Enter)"
                aria-label="Inject message"
              >
                ⤓
              </button>
              <button
                className={`bg-transparent border-none cursor-pointer text-sm w-6 h-6 rounded flex-shrink-0 flex items-center justify-center p-0 leading-none ${status === "cancelling" ? "text-fg-muted cursor-not-allowed" : "text-fg-secondary hover:text-error"}`}
                onClick={
                  status === "running"
                    ? () => onCancel(cancelTargets)
                    : undefined
                }
                disabled={status === "cancelling"}
                title={
                  status === "cancelling"
                    ? "Cancelling…"
                    : "Stop generation (⌘+Enter)"
                }
              >
                {status === "cancelling" ? "◔" : "■"}
              </button>
            </>
          ) : (
            <button
              className="bg-transparent border-none cursor-pointer text-sm w-6 h-6 rounded flex-shrink-0 flex items-center justify-center p-0 leading-none text-accent hover:bg-accent-hover disabled:text-fg-muted disabled:cursor-not-allowed"
              onClick={handleSend}
              disabled={
                disabled || (!text.trim() && attachments.length === 0)
              }
              title="Send to active session"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    );
  }
);
