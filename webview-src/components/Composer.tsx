import React, { useState, useRef, useCallback, type KeyboardEvent } from "react";
import type { ContextAttachment, SuggestionItem, TriggerType } from "../types";
import type { SlashCommand } from "../hooks/useSessionContext";
import { ContextBar } from "./ContextBar";
import { ContextPicker } from "./ContextPicker";
import type { FileCandidate } from "./ContextPicker";

const TRIGGER_CHARS: TriggerType[] = ["/", "#"];
const MAX_HISTORY = 50;

// ── Trigger state ──────────────────────────────────────────────────

interface TriggerState {
  active: boolean;
  trigger: TriggerType;
  query: string;
  caretOffset: number;
}

const NO_TRIGGER: TriggerState = {
  active: false,
  trigger: "#",
  query: "",
  caretOffset: 0,
};

// ── Props ──────────────────────────────────────────────────────────

export interface ComposerProps {
  onSend: (text: string, attachments: ContextAttachment[]) => void;
  onCancel: () => void;
  disabled?: boolean;
  isTurnActive?: boolean;
  fetchFiles: (query: string) => Promise<FileCandidate[]>;
  resolveFile: (path: string) => Promise<ContextAttachment>;
  resolveSelection: () => Promise<ContextAttachment | null>;
  resolveDiff: () => Promise<ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<ContextAttachment>;
  availableCommands?: SlashCommand[];
}

// ── Component ───────────────────────────────────────────────────────

export function Composer({
  onSend,
  onCancel,
  disabled = false,
  isTurnActive = false,
  fetchFiles,
  resolveFile,
  resolveSelection,
  resolveDiff,
  fetchSymbols,
  resolveSymbol,
  availableCommands = [],
}: ComposerProps): React.ReactElement {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [triggerState, setTriggerState] = useState<TriggerState>(NO_TRIGGER);
  const [pickerIndex, setPickerIndex] = useState(0);
  // Batch text + trigger into a single state update to avoid double render
  const textRef = useRef("");
  const triggerRef = useRef<TriggerState>(NO_TRIGGER);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const inputBeforeNavRef = useRef("");

  // ── Trigger detection ────────────────────────────────────────────

  const detectTrigger = useCallback(
    (value: string, caretPos: number): TriggerState => {
      const beforeCaret = value.slice(0, caretPos);

      // Walk backwards through trigger chars; pick the rightmost one
      // that sits directly before the caret with no space/newline gap.
      for (const ch of TRIGGER_CHARS) {
        const idx = beforeCaret.lastIndexOf(ch);
        if (idx < 0) continue;
        const afterTrigger = beforeCaret.slice(idx + 1);
        if (afterTrigger.includes(" ") || afterTrigger.includes("\n")) continue;

        // Trigger char is immediately before caret (possibly with query text)
        return {
          active: true,
          trigger: ch,
          query: afterTrigger,
          caretOffset: idx,
        };
      }

      return NO_TRIGGER;
    },
    []
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const caret = e.target.selectionStart ?? value.length;
      const newTrigger = detectTrigger(value, caret);

      // Write to refs immediately (no render) so textarea stays responsive
      textRef.current = value;
      triggerRef.current = newTrigger;

      // Single batched state update
      if (historyIdxRef.current !== -1) {
        historyIdxRef.current = -1;
        inputBeforeNavRef.current = "";
      }
      setText(value);
      setTriggerState(newTrigger);

      const textarea = e.target;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    },
    [detectTrigger]
  );

  // ── Suggestion fetch (delegates to Composer's own fetchers) ─────

  const fetchSuggestions = useCallback(
    async (trigger: TriggerType, query: string): Promise<SuggestionItem[]> => {
      if (trigger === "/") {
        // Build items from agent-provided commands
        const agentItems: SuggestionItem[] = availableCommands.map((cmd) => ({
          id: `agent:${cmd.name}`,
          kind: "command" as const,
          label: `/${cmd.name}`,
          value: `/${cmd.name}`,
          detail: cmd.description ?? undefined,
          icon: "⚡",
        }));

        // Built-in commands (shown when no agent commands or alongside them)
        const builtIn: SuggestionItem[] = [
          { id: "/new", kind: "command", label: "/new", value: "/new", detail: "Start a new session", icon: "✨" },
          { id: "/reset", kind: "command", label: "/reset", value: "/reset", detail: "Reset current session", icon: "🔄" },
        ];

        const all = [...agentItems, ...builtIn];
        if (query) {
          const q = query.toLowerCase();
          return all.filter(
            (c) => c.label.toLowerCase().includes(q) || (c.detail ?? "").toLowerCase().includes(q)
          );
        }
        return all;
      }

      // trigger === "#"
      // # with "symbol" prefix → symbol search
      if (query.toLowerCase().startsWith("symbol")) {
        const symQuery = query.slice("symbol".length).trim();
        return fetchSymbols(symQuery);
      }

      // # alone or #<file-query> → file search
      const files = await fetchFiles(query);
      const fileItems: SuggestionItem[] = files.map((f) => ({
        id: `file:${f.relativePath}`,
        kind: "file" as const,
        label: f.name,
        value: f.relativePath,
        detail: f.relativePath,
        icon: "📄",
      }));
      // Always append special context at the bottom
      fileItems.push(
        {
          id: "special:selection",
          kind: "selection",
          label: "#selection — Attach current selection",
          value: "__selection__",
          icon: "🖱",
        },
        {
          id: "special:diff",
          kind: "diff",
          label: "#diff — Attach working tree diff",
          value: "__diff__",
          icon: "📋",
        }
      );
      return fileItems;
    },
    [fetchFiles, fetchSymbols]
  );

  // ── Suggestion selected ──────────────────────────────────────────

  const handleSelect = useCallback(
    async (item: SuggestionItem) => {
      // Remove the trigger+query text from the input
      const before = text.slice(0, triggerState.caretOffset);
      const afterOffset = triggerState.caretOffset + 1 + triggerState.query.length;
      const after = text.slice(afterOffset);
      const space = after.startsWith(" ") ? "" : " ";

      if (item.kind === "file") {
        try {
          const attachment = await resolveFile(item.value);
          setAttachments((prev) => [...prev, attachment]);
        } catch {
          /* silently fail */
        }
        setText(before + after);
      } else if (item.kind === "selection") {
        try {
          const attachment = await resolveSelection();
          if (attachment) setAttachments((prev) => [...prev, attachment]);
        } catch {
          /* silently fail */
        }
        setText(before + after);
      } else if (item.kind === "diff") {
        try {
          const attachment = await resolveDiff();
          if (attachment) setAttachments((prev) => [...prev, attachment]);
        } catch {
          /* silently fail */
        }
        setText(before + after);
      } else if (item.kind === "command") {
        // Execute the command inline (e.g. /new clears chat)
        if (item.value === "/new") {
          setText("");
        } else {
          // For non-inline commands, replace the trigger line with the command
          setText(before + item.value + space + after);
        }
      } else if (item.kind === "symbol") {
        try {
          const attachment = await resolveSymbol(item.value);
          setAttachments((prev) => [...prev, attachment]);
        } catch {
          /* silently fail */
        }
        setText(before + after);
      }

      setTriggerState(NO_TRIGGER);
      setPickerIndex(0);
      textareaRef.current?.focus();
    },
    [text, triggerState, resolveFile, resolveSelection, resolveDiff, resolveSymbol]
  );

  const handleCloseTrigger = useCallback(() => {
    setTriggerState(NO_TRIGGER);
    setPickerIndex(0);
  }, []);

  // ── Attachment management ────────────────────────────────────────

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
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
      onSend(trimmed, attachments);
      setText("");
      setAttachments([]);
      setTriggerState(NO_TRIGGER);
      setPickerIndex(0);
      resetHeight();
    }
  }, [text, attachments, disabled, onSend, resetHeight]);

  // ── Picker keyboard handler (called via ref from ContextPicker) ──

  const pickerKeyDownRef = useRef<((e: KeyboardEvent) => void) | null>(null);

  const handlePickerKeyDown = useCallback((handler: (e: KeyboardEvent) => void) => {
    pickerKeyDownRef.current = handler;
  }, []);

  const clearPickerKeyDown = useCallback(() => {
    pickerKeyDownRef.current = null;
  }, []);

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
    [handleSend, text, resetHeight, triggerState.active]
  );

  // ── Render ───────────────────────────────────────────────────────

  const placeholder = disabled
    ? "Connect to an agent first\u2026"
    : "Message (Enter to send, Shift+Enter for newline, # file / command)";

  return (
    <div className="composer">
      <ContextBar attachments={attachments} onRemove={handleRemoveAttachment} />
      {triggerState.active && (
        <ContextPicker
          trigger={triggerState.trigger}
          query={triggerState.query}
          onSelect={handleSelect}
          onClose={handleCloseTrigger}
          fetchItems={fetchSuggestions}
          selectedIndex={pickerIndex}
          onSelectedIndexChange={setPickerIndex}
          registerKeyHandler={handlePickerKeyDown}
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
        {isTurnActive ? (
          <button className="stop-button" onClick={onCancel} title="Stop generation">
            ■
          </button>
        ) : (
          <button
            className="send-button"
            onClick={handleSend}
            disabled={disabled || (!text.trim() && attachments.length === 0)}
            title="Send message"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}
