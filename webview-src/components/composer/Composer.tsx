import React, {
  useState,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import type {
  CommunicationMode,
  ContextAttachment,
  QueuedPrompt,
  SelectedTeam,
  SuggestionItem,
  TriggerType,
} from "../../types";
import type { SlashCommand, SessionTabState } from "../../store/sessionStore";
import type { SendTarget } from "../../types";
import { useSessionStore } from "../../store/sessionStore";
import { useMessageStore } from "../../store/messageStore";
import { useMeshStore } from "../../store/meshStore";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { getLogger } from "../../lib/logger";
import { sessionColorForKey } from "../../shared/sessionColor";

const log = getLogger("webview.Composer");
import { ContextBar } from "./ContextBar";
import { ContextPicker } from "./ContextPicker";
import type { FileCandidate } from "./ContextPicker";
import { Icon } from "../../lib/icons";
import {
  useTriggerPicker,
  type TriggerState,
  type SelectOutput,
} from "../../hooks/useTriggerPicker";

const MAX_HISTORY = 50;

// ── Mode label + icon config ────────────────────────────────────────

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

// ── Props ──────────────────────────────────────────────────────────

export interface ComposerProps {
  onSend: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[],
    mode?: CommunicationMode | null,
    teamId?: string
  ) => void;
  onCancel: () => void;
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
  availableCommands?: SlashCommand[];
  /** Queued prompts for the active session */
  queue?: QueuedPrompt[];
  /** Send a queued prompt immediately (bypassing queue) */
  onSendNow?: (promptId: string) => void;
  /** Remove a single queued prompt */
  onRemoveQueueItem?: (promptId: string) => void;
  /** Clear all queued prompts */
  onClearQueue?: () => void;
}

// ── Relative time helper ───────────────────────────────────────────

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

// ── Session suggestion factory (shared by @ and #switch) ───────────

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
    const sessionColor =
      info?.sessionColor ?? sessionColorForKey(key);

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

// ── Component ───────────────────────────────────────────────────────

export function Composer({
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
  availableCommands = [],
  queue = [],
  onSendNow,
  onRemoveQueueItem,
  onClearQueue,
}: ComposerProps): React.ReactElement {
  // Read tabs imperatively — getTabs() returns a new array each call,
  // which would cause an infinite loop via useSyncExternalStore.
  const tabs = useSessionStore.getState().getTabs();
  const connectedAgents = useSessionStore((s) => s.connectedAgents);

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const inputBeforeNavRef = useRef("");

  // ── Reset textarea height ─────────────────────────────────────────
  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, []);

  // ── Reset picker (ref-wired; useTriggerPicker.reset is assigned after init) ──
  const resetPickerImpl = useRef<() => void>(() => {});
  const resetPicker = useCallback(() => {
    resetPickerImpl.current();
  }, []);

  // ── Multi-@ send targets ──────────────────────────────────────────
  const sendTargets = useMeshStore((s) => s.sendTargets);
  const addSendTarget = useMeshStore((s) => s.addSendTarget);
  const removeSendTarget = useMeshStore((s) => s.removeSendTarget);
  const clearSendTargets = useMeshStore((s) => s.clearSendTargets);

  // ── Selected team (@team: picker) ────────────────────────────────
  const selectedTeam = useMeshStore((s) => s.selectedTeam);
  const setSelectedTeam = useMeshStore((s) => s.setSelectedTeam);

  // ── Mesh communication mode ──────────────────────────────────────
  const communicationMode = useMeshStore((s) => s.communicationMode);
  const setCommunicationMode = useMeshStore((s) => s.setCommunicationMode);

  // Track multi-@ mode: true when at least one @ target is selected
  const isMultiMode = sendTargets.length > 0;

  // ── Send to All Pinned ────────────────────────────────────────────
  const pinnedSessionKeys = useSessionStore((s) => s.pinnedSessionKeys);
  const hasPinnedSessions = pinnedSessionKeys.length > 0;

  const handleSendToAllPinned = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;

    // Build targets from all pinned sessions
    const sessionInfoMap = useSessionStore.getState().sessionInfoMap;
    const pinnedTargets: SendTarget[] = pinnedSessionKeys
      .filter((key) => sessionInfoMap[key]) // only include sessions that exist
      .map((key) => {
        const [agentId, sessionId] = key.split(":");
        const info = sessionInfoMap[key];
        return {
          agentId,
          sessionId,
          label: info?.sessionId?.slice(0, 8) ?? sessionId,
          status: (info?.status ?? "idle") as
            | "idle"
            | "running"
            | "completed"
            | "error"
            | "cancelled",
          tokenUsage: info?.tokenUsage,
          contextWindowMax: info?.contextWindowMax,
        };
      });

    if (pinnedTargets.length === 0) return;

    log.info("sendToAllPinned", {
      textLen: trimmed.length,
      targetCount: pinnedTargets.length,
    });
    onSend(trimmed, attachments, pinnedTargets);

    resetPicker();
    setText("");
    setAttachments([]);
    resetHeight();
  }, [
    text,
    attachments,
    disabled,
    pinnedSessionKeys,
    onSend,
    resetHeight,
    resetPicker,
  ]);

  // ── Team suggestion factory ─────────────────────────────────────

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

  // ── Suggestion fetch ─────────────────────────────────────────────

  const fetchSuggestions = useCallback(
    async (
      trigger: TriggerType,
      query: string,
      subTrigger?: "symbol" | "file" | "switch" | "team"
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
              if (!cwdSources.has(info.cwd)) cwdSources.set(info.cwd, new Set());
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
              if (!existing.sourceCwds.includes(cwd)) existing.sourceCwds.push(cwd);
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

  // ── Item resolution (called by hook's handleSelect) ──────────────

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
          consumed = 1 + triggerState.subTrigger.length + 1 + triggerState.query.length;
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
          getVsCodeApi().postMessage({ type: "mesh:plan" });
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
        const team = useMeshStore.getState().teams.find((t) => t.id === item.value);
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
      onNewSession,
      onSwitchSession,
      addSendTarget,
      isMultiMode,
    ]
  );

  // ── Trigger picker hook ─────────────────────────────────────────

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

  // ── Text-change handler ──────────────────────────────────────────

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

      const textarea = e.target;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    },
    [onTriggerChange, setPickerIndex, isMultiMode]
  );

  // ── Attachment management ────────────────────────────────────────

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ── Queue helpers ────────────────────────────────────────────────

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
      onSend(trimmed, sendAttachments, targets, communicationMode, selectedTeam?.id);

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

  // ── Send ─────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if ((trimmed || attachments.length > 0) && !disabled) {
      if (trimmed) {
        const h = historyRef.current;
        if (h.length === 0 || h[h.length - 1] !== trimmed) {
          h.push(trimmed);
          if (h.length > MAX_HISTORY) h.shift();
        }
      }
      historyIdxRef.current = -1;
      inputBeforeNavRef.current = "";

      const targets = sendTargets.length > 0 ? sendTargets : undefined;
      log.info("send", {
        textLen: trimmed.length,
        attachments: attachments.length,
        targets: targets?.length ?? 0,
        mode: communicationMode,
        teamId: selectedTeam?.id ?? null,
      });
      onSend(trimmed, attachments, targets, communicationMode, selectedTeam?.id);

      clearSendTargets();
      setSelectedTeam(null);
      setCommunicationMode(null);
      resetPicker();
      setText("");
      setAttachments([]);
      resetHeight();
    }
  }, [
    text,
    attachments,
    disabled,
    onSend,
    sendTargets,
    clearSendTargets,
    selectedTeam,
    setSelectedTeam,
    resetHeight,
    resetPicker,
  ]);

  // ── Keyboard navigation (history + picker) ───────────────────────

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
        handleSend();
        return;
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
          resetHeight();
          return;
        }
        if (historyIdxRef.current > 0) {
          historyIdxRef.current--;
          e.preventDefault();
          setText(history[historyIdxRef.current]);
          resetHeight();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        const history = historyRef.current;
        if (historyIdxRef.current === -1) return;
        if (historyIdxRef.current < history.length - 1) {
          historyIdxRef.current++;
          e.preventDefault();
          setText(history[historyIdxRef.current]);
          resetHeight();
        } else {
          e.preventDefault();
          setText(inputBeforeNavRef.current);
          historyIdxRef.current = -1;
          inputBeforeNavRef.current = "";
          resetHeight();
        }
        return;
      }
    },
    [handleSend, text, resetHeight, triggerState.active, pickerKeyDownRef]
  );

  // ── Render ───────────────────────────────────────────────────────

  const placeholder = disabled
    ? "Connect to an agent first\u2026"
    : "Message (Enter to send, Shift+Enter for newline, # file / command, @ session)";

  return (
    <div className="composer flex-shrink-0 px-3 pt-1.5 pb-2">
      <ContextBar
        attachments={attachments}
        onRemove={handleRemoveAttachment}
        sendTargets={sendTargets}
        onRemoveSendTarget={removeSendTarget}
        connectedAgents={connectedAgents}
        selectedTeam={selectedTeam}
        onRemoveSelectedTeam={() => setSelectedTeam(null)}
      />

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
              <li key={entry.id} className="flex items-center justify-between gap-1 px-2 py-[3px] border-b border-[color-mix(in_srgb,var(--border)_30%,transparent)] last:border-b-0">
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
        {status === "running" || status === "cancelling" ? (
          <button
            className={`bg-transparent border-none cursor-pointer text-sm w-6 h-6 rounded flex-shrink-0 flex items-center justify-center p-0 leading-none ${status === "cancelling" ? "text-fg-muted cursor-not-allowed" : "text-fg-secondary hover:text-error"}`}
            onClick={status === "running" ? onCancel : undefined}
            disabled={status === "cancelling"}
            title={status === "cancelling" ? "Cancelling…" : "Stop generation"}
          >
            {status === "cancelling" ? "◔" : "■"}
          </button>
        ) : (
          <>
            <button
              className="bg-transparent border-none cursor-pointer text-sm w-6 h-6 rounded flex-shrink-0 flex items-center justify-center p-0 leading-none text-accent hover:bg-accent-hover disabled:text-fg-muted disabled:cursor-not-allowed"
              onClick={handleSend}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              title="Send to active session"
            >
              ↑
            </button>
            {hasPinnedSessions && (
              <button
                className="bg-transparent border-none cursor-pointer text-sm w-6 h-6 rounded flex-shrink-0 flex items-center justify-center p-0 leading-none text-accent opacity-80 hover:opacity-100 hover:bg-accent-hover disabled:text-fg-muted disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleSendToAllPinned}
                disabled={
                  disabled || (!text.trim() && attachments.length === 0)
                }
                title={`Send to all pinned (${pinnedSessionKeys.length})`}
              >
                ↑↑
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
