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
  /** For #: "symbol" | "file" | null (not yet disambiguated) */
  subTrigger?: "symbol" | "file";
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

      // Walk backwards through trigger chars; pick the rightmost one.
      for (const ch of TRIGGER_CHARS) {
        const idx = beforeCaret.lastIndexOf(ch);
        if (idx < 0) continue;
        const afterTrigger = beforeCaret.slice(idx + 1);

        if (ch === "/") {
          // /command — no space gap allowed between / and query
          if (afterTrigger.includes(" ") || afterTrigger.includes("\n")) continue;
          return {
            active: true,
            trigger: ch,
            query: afterTrigger,
            caretOffset: idx,
          };
        }

        // ch === "#"
        // Split into tokens (space-separated) after the #
        const tokens = afterTrigger.split(/\s+/).filter(Boolean);

        if (tokens.length === 0) {
          // "#" only or "# " — show subcommand completions
          return {
            active: true,
            trigger: "#",
            subTrigger: undefined,
            query: "",
            caretOffset: idx,
          };
        }

        const first = tokens[0].toLowerCase();

        if (first === "symbol" || first === "file") {
          // #symbol or #file
          if (tokens.length === 1) {
            // "#symbol" or "#file" — open picker with empty query
            return {
              active: true,
              trigger: "#",
              subTrigger: first as "symbol" | "file",
              query: "",
              caretOffset: idx,
            };
          }
          // "#symbol Foo" or "#file src/" — space + query typed
          const rest = afterTrigger.slice(first.length).trimStart();
          return {
            active: true,
            trigger: "#",
            subTrigger: first as "symbol" | "file",
            query: rest,
            caretOffset: idx,
          };
        }

        // "#something" where something is not "symbol" or "file"
        // Show subcommand completions filtered by the typed text
        // This allows "#f" to show "file" and "symbol" as suggestions
        return {
          active: true,
          trigger: "#",
          subTrigger: undefined,
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
    async (trigger: TriggerType, query: string, subTrigger?: "symbol" | "file"): Promise<SuggestionItem[]> => {
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
      if (subTrigger === "symbol") {
        return fetchSymbols(query);
      }

      if (subTrigger === "file") {
        // #file <query> — file search
        const files = await fetchFiles(query);
        const fileItems: SuggestionItem[] = files.map((f) => ({
          id: `file:${f.relativePath}`,
          kind: "file" as const,
          label: f.name,
          value: f.relativePath,
          detail: f.relativePath,
          icon: "📄",
        }));
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
      }

      // subTrigger === undefined → "# " — show subcommand completions
      const subCommands: SuggestionItem[] = [
        { id: "sub:file", kind: "file", label: "file", value: "file", detail: "Attach a file", icon: "📄" },
        { id: "sub:symbol", kind: "symbol", label: "symbol", value: "symbol", detail: "Attach a symbol", icon: "🔷" },
        { id: "sub:selection", kind: "selection", label: "selection", value: "__selection__", detail: "Attach current selection", icon: "🖱" },
        { id: "sub:diff", kind: "diff", label: "diff", value: "__diff__", detail: "Attach working tree diff", icon: "📋" },
      ];
      if (query) {
        const q = query.toLowerCase();
        return subCommands.filter(
          (c) => c.label.toLowerCase().includes(q) || (c.detail ?? "").toLowerCase().includes(q)
        );
      }
      return subCommands;
    },
    [fetchFiles, fetchSymbols]
  );

  // ── Suggestion selected ──────────────────────────────────────────

  /**
   * Calculate the length of text consumed by the trigger expression.
   * For "/cmd":       "/" + "cmd" = 1 + query.length
   * For "#file src/": "#file" + " " + "src/" = 1 + subTrigger.length + 1 + query.length
   * For "#file":      "#file" = 1 + subTrigger.length (no space, no query)
   * For "#query":     "#query" = 1 + query.length
   */
  const getConsumedLength = useCallback(
    (ts: TriggerState): number => {
      if (ts.trigger === "/") return 1 + ts.query.length;
      // "#"
      if (ts.subTrigger) {
        // "#subTrigger" + optional " query"
        const base = 1 + ts.subTrigger.length;
        return ts.query.length > 0 ? base + 1 + ts.query.length : base;
      }
      return 1 + ts.query.length;
    },
    []
  );

  const handleSelect = useCallback(
    async (item: SuggestionItem) => {
      const before = text.slice(0, triggerState.caretOffset);
      const consumed = getConsumedLength(triggerState);
      const after = text.slice(triggerState.caretOffset + consumed);
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

      // Subcommand selected from bare "#" picker — expand and reopen
      if (triggerState.subTrigger === undefined) {
        if (item.kind === "file" || item.kind === "symbol") {
          const kw = item.kind;
          // Preserve the "#" and expand: "#query" → "#kw "
          const newText = before + "#" + kw + " " + after;
          setText(newText);
          setTriggerState({
            active: true,
            trigger: "#",
            subTrigger: kw,
            query: "",
            caretOffset: triggerState.caretOffset,
          });
          setPickerIndex(0);
          // Position caret after "#kw "
          setTimeout(() => {
            if (textareaRef.current) {
              const pos = before.length + 1 + kw.length + 1;
              textareaRef.current.selectionStart = pos;
              textareaRef.current.selectionEnd = pos;
              textareaRef.current.focus();
            }
          }, 0);
          return;
        }
        // selection / diff — resolve immediately (handled above)
      }

      setTriggerState(NO_TRIGGER);
      setPickerIndex(0);
      textareaRef.current?.focus();
    },
    [text, triggerState, resolveFile, resolveSelection, resolveDiff, resolveSymbol, getConsumedLength]
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
          subTrigger={triggerState.subTrigger}
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
