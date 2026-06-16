import React, {
  useState,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import type { ContextAttachment, SuggestionItem, TriggerType } from "../types";
import type { SlashCommand, SessionTabState } from "../store/sessionStore";
import type { SendTarget } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { useMeshStore } from "../store/meshStore";
import { getLogger } from "../lib/logger";

const log = getLogger("webview.Composer");
import { ContextBar } from "./ContextBar";
import { ContextPicker } from "./ContextPicker";
import type { FileCandidate } from "./ContextPicker";
import { Icon } from "../lib/icons";
import {
  useTriggerPicker,
  type TriggerState,
  type SelectOutput,
} from "../hooks/useTriggerPicker";

const MAX_HISTORY = 50;

// ── Props ──────────────────────────────────────────────────────────

export interface ComposerProps {
  onSend: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[]
  ) => void;
  onCancel: () => void;
  onNewSession?: () => void;
  onSwitchSession?: (agentId: string, sessionId: string) => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  disabled?: boolean;
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
  fetchFiles: (query: string) => Promise<FileCandidate[]>;
  resolveFile: (path: string) => Promise<ContextAttachment>;
  resolveSelection: () => Promise<ContextAttachment | null>;
  resolveDiff: () => Promise<ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<ContextAttachment>;
  availableCommands?: SlashCommand[];
}

// ── Session suggestion factory (shared by @ and #switch) ───────────

function buildSessionSuggestions(
  tabs: SessionTabState[],
  query: string
): SuggestionItem[] {
  const sessionInfoMap = useSessionStore.getState().sessionInfoMap;
  const items: SuggestionItem[] = tabs.map((tab) => {
    const key = `${tab.agentId}:${tab.sessionId}`;
    const info = sessionInfoMap[key];
    return {
      id: `session:${tab.agentId}:${tab.sessionId}`,
      kind: "session" as const,
      label: tab.title ?? tab.sessionId.slice(0, 8),
      value: `${tab.agentId}:${tab.sessionId}`,
      detail: tab.agentId,
      icon: "chat",
      agentId: tab.agentId,
      sessionId: tab.sessionId,
      status: info?.status ?? "idle",
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
}: ComposerProps): React.ReactElement {
  // Read tabs imperatively — getTabs() returns a new array each call,
  // which would cause an infinite loop via useSyncExternalStore.
  const tabs = useSessionStore.getState().getTabs();

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
  const resetPicker = useCallback(() => { resetPickerImpl.current(); }, []);

  // ── Multi-@ send targets ──────────────────────────────────────────
  const sendTargets = useMeshStore((s) => s.sendTargets);
  const addSendTarget = useMeshStore((s) => s.addSendTarget);
  const removeSendTarget = useMeshStore((s) => s.removeSendTarget);
  const clearSendTargets = useMeshStore((s) => s.clearSendTargets);

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
          status: (info?.status ?? "idle") as "idle" | "running" | "completed" | "error" | "cancelled",
        };
      });

    if (pinnedTargets.length === 0) return;

    log.info("sendToAllPinned", { textLen: trimmed.length, targetCount: pinnedTargets.length });
    onSend(trimmed, attachments, pinnedTargets);

    resetPicker();
    setText("");
    setAttachments([]);
    resetHeight();
  }, [text, attachments, disabled, pinnedSessionKeys, onSend, resetHeight, resetPicker]);

  // ── Suggestion fetch ─────────────────────────────────────────────

  const fetchSuggestions = useCallback(
    async (
      trigger: TriggerType,
      query: string,
      subTrigger?: "symbol" | "file" | "switch"
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
        if (query) {
          const q = query.toLowerCase();
          return agentItems.filter(
            (c) =>
              c.label.toLowerCase().includes(q) ||
              (c.detail ?? "").toLowerCase().includes(q)
          );
        }
        return agentItems;
      }

      if (trigger === "@") {
        return buildSessionSuggestions(tabs, query);
      }

      if (subTrigger === "symbol") {
        return fetchSymbols(query);
      }

      if (subTrigger === "file") {
        const files = await fetchFiles(query);
        const fileItems: SuggestionItem[] = files.map((f) => ({
          id: `file:${f.relativePath}`,
          kind: "file" as const,
          label: f.name,
          value: f.relativePath,
          detail: f.relativePath,
          icon: "file",
        }));
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
    async (input: Parameters<typeof handleSelect>[0]): Promise<SelectOutput> => {
      const { triggerState, item } = input;
      let newText = input.text;
      const consumed =
        triggerState.trigger === "/" || triggerState.trigger === "@"
          ? 1 + triggerState.query.length
          : triggerState.subTrigger
            ? 1 +
              triggerState.subTrigger.length +
              (triggerState.query.length > 0
                ? 1 + triggerState.query.length
                : 0)
            : 1 + triggerState.query.length;

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
      } else if (item.kind === "session") {
        if (triggerState.subTrigger === "switch") {
          onSwitchSession?.(item.agentId!, item.sessionId!);
          newText = "";
          setText(newText);
        } else {
          // Multi-@: add to send targets instead of replacing
          const target: SendTarget = {
            agentId: item.agentId!,
            sessionId: item.sessionId!,
            label: item.label,
            status: "idle",
          };
          addSendTarget(target);

          // Replace @query with transparent marker (chip shown below)
          const completion = `@${item.label} `;
          newText = before + completion + after;
          setText(newText);

          requestAnimationFrame(() => {
            if (textareaRef.current) {
              const pos = before.length + completion.length;
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
          multiMode: isMultiMode || (item.kind === "session" && triggerState.subTrigger !== "switch"),
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

      // Pass targets if multi-@ mode, otherwise undefined (defaults to active session)
      const targets = sendTargets.length > 0 ? sendTargets : undefined;
      log.info("send", { textLen: trimmed.length, attachments: attachments.length, targets: targets?.length ?? 0 });
      onSend(trimmed, attachments, targets);

      clearSendTargets();
      resetPicker();
      setText("");
      setAttachments([]);
      resetHeight();
    }
  }, [text, attachments, disabled, onSend, sendTargets, clearSendTargets, resetHeight, resetPicker]);

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

      // Picker closed: ArrowUp/Down navigates message history
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
    <div className="composer">
      <ContextBar attachments={attachments} onRemove={handleRemoveAttachment} />

      {/* Multi-@ send target chips — rendered in ContextBar style */}
      {sendTargets.length > 0 && (
        <div className="send-targets-bar">
          {sendTargets.map((target) => (
              <span
                key={`${target.agentId}:${target.sessionId}`}
                className="context-chip"
                title={`${target.agentId}:${target.sessionId}`}
              >
                <Icon name="chat" className="context-chip-icon" size="sm" />
                <span className="context-chip-label">{target.label}</span>
                <button
                  className="context-chip-remove"
                  onClick={() => removeSendTarget(target.agentId, target.sessionId)}
                  title="Remove"
                >
                  <Icon name="close" size="sm" />
                </button>
              </span>
            ))}
        </div>
      )}

      {triggerState.active && (
        <ContextPicker
          trigger={triggerState.trigger}
          subTrigger={triggerState.subTrigger}
          query={triggerState.query}
          onSelect={(item) =>
            handleSelect({ text, triggerState, item })
          }
          onClose={onClosePicker}
          fetchItems={fetchSuggestions}
          selectedIndex={pickerIndex}
          onSelectedIndexChange={setPickerIndex}
          registerKeyHandler={registerKeyHandler}
        />
      )}
      <div className="composer-inner">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
        />
        {status === "running" ? (
          <button
            className="stop-button"
            onClick={onCancel}
            title="Stop generation"
          >
            ■
          </button>
        ) : (
          <>
            <button
              className="send-button"
              onClick={handleSend}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              title="Send to active session"
            >
              ↑
            </button>
            {hasPinnedSessions && (
              <button
                className="send-all-button"
                onClick={handleSendToAllPinned}
                disabled={disabled || (!text.trim() && attachments.length === 0)}
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
