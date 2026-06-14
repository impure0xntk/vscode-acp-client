import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import type { SuggestionItem, TriggerType } from "../types";

// ── Trigger characters ─────────────────────────────────────────────

const TRIGGER_CHARS: TriggerType[] = ["/", "#", "@"];

// ── Types ──────────────────────────────────────────────────────────

export interface TriggerState {
  active: boolean;
  trigger: TriggerType;
  query: string;
  caretOffset: number;
  subTrigger?: "symbol" | "file" | "switch";
}

const NO_TRIGGER: TriggerState = {
  active: false,
  trigger: "#",
  query: "",
  caretOffset: 0,
};

export interface ConsumedLengthInput {
  trigger: TriggerType;
  subTrigger?: string;
  query: string;
}

export interface SelectInput {
  text: string;
  triggerState: TriggerState;
  item: SuggestionItem;
}

export interface SelectOutput {
  text: string;
  triggerState: TriggerState;
}

export interface UseTriggerPickerOptions {
  fetchSuggestions: (
    trigger: TriggerType,
    query: string,
    subTrigger?: "symbol" | "file" | "switch"
  ) => Promise<SuggestionItem[]>;
  resolveItem: (item: SelectInput) => Promise<SelectOutput>;
}

export interface UseTriggerPickerReturn {
  triggerState: TriggerState;
  pickerIndex: number;
  setPickerIndex: (i: number) => void;
  handleChange: (value: string, caretPos: number) => TriggerState;
  handleSelect: (input: SelectInput) => Promise<SelectOutput>;
  handleClose: () => void;
  reset: () => void;
  pickerKeyDownRef: React.MutableRefObject<((e: KeyboardEvent) => void) | null>;
  registerKeyHandler: (handler: ((e: KeyboardEvent) => void) | null) => void;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useTriggerPicker(
  options: UseTriggerPickerOptions
): UseTriggerPickerReturn {
  const { fetchSuggestions, resolveItem } = options;

  const [triggerState, setTriggerState] = useState<TriggerState>(NO_TRIGGER);
  const [pickerIndex, setPickerIndex] = useState(0);

  const suppressTriggerRef = useRef(false);
  const dismissedRef = useRef(false);
  const pickerKeyDownRef = useRef<((e: KeyboardEvent) => void) | null>(null);

  // ── Consumed length ──────────────────────────────────────────────

  const getConsumedLength = useCallback((ts: ConsumedLengthInput): number => {
    if (ts.trigger === "/" || ts.trigger === "@") return 1 + ts.query.length;
    if (ts.subTrigger) {
      const base = 1 + ts.subTrigger.length;
      return ts.query.length > 0 ? base + 1 + ts.query.length : base;
    }
    return 1 + ts.query.length;
  }, []);

  // ── Trigger detection ────────────────────────────────────────────

  const detectTrigger = useCallback(
    (value: string, caretPos: number): TriggerState => {
      const charTyped = caretPos > 0 ? value[caretPos - 1] : undefined;

      if (dismissedRef.current) {
        if (
          charTyped !== undefined &&
          (TRIGGER_CHARS as string[]).includes(charTyped)
        ) {
          dismissedRef.current = false;
        } else {
          return NO_TRIGGER;
        }
      }

      if (suppressTriggerRef.current) {
        suppressTriggerRef.current = false;
        if (dismissedRef.current) return NO_TRIGGER;
        return NO_TRIGGER;
      }

      const beforeCaret = value.slice(0, caretPos);

      for (const ch of TRIGGER_CHARS) {
        const idx = beforeCaret.lastIndexOf(ch);
        if (idx < 0) continue;
        const afterTrigger = beforeCaret.slice(idx + 1);

        if (ch === "/") {
          if (afterTrigger.includes(" ") || afterTrigger.includes("\n"))
            continue;
          return {
            active: true,
            trigger: ch,
            query: afterTrigger,
            caretOffset: idx,
          };
        }

        if (ch === "@") {
          if (idx > 0 && /\w/.test(beforeCaret[idx - 1])) continue;
          if (afterTrigger.includes(" ") || afterTrigger.includes("\n"))
            continue;
          return {
            active: true,
            trigger: "@",
            query: afterTrigger,
            caretOffset: idx,
          };
        }

        // ch === "#"
        const tokens = afterTrigger.split(/\s+/).filter(Boolean);

        if (tokens.length === 0) {
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
          if (tokens.length === 1) {
            return {
              active: true,
              trigger: "#",
              subTrigger: first as "symbol" | "file",
              query: "",
              caretOffset: idx,
            };
          }
          const rest = afterTrigger.slice(first.length).trimStart();
          return {
            active: true,
            trigger: "#",
            subTrigger: first as "symbol" | "file",
            query: rest,
            caretOffset: idx,
          };
        }

        if (first === "switch") {
          if (tokens.length === 1) {
            return {
              active: true,
              trigger: "#",
              subTrigger: "switch",
              query: "",
              caretOffset: idx,
            };
          }
          const rest = afterTrigger.slice("switch".length).trimStart();
          return {
            active: true,
            trigger: "#",
            subTrigger: "switch",
            query: rest,
            caretOffset: idx,
          };
        }

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

  // ── Handler: text change ─────────────────────────────────────────

  const handleChange = useCallback(
    (value: string, caretPos: number): TriggerState => {
      const newTrigger = detectTrigger(value, caretPos);
      setTriggerState(newTrigger);
      return newTrigger;
    },
    [detectTrigger]
  );

  // ── Handler: suggestion selected ─────────────────────────────────

  const handleSelect = useCallback(
    async (input: SelectInput): Promise<SelectOutput> => {
      suppressTriggerRef.current = true;

      // Subcommand expansion from bare "#"
      if (
        input.triggerState.subTrigger === undefined &&
        (input.item.kind === "file" || input.item.kind === "symbol")
      ) {
        const kw = input.item.kind;
        const before = input.text.slice(0, input.triggerState.caretOffset);
        const consumed = getConsumedLength(input.triggerState);
        const after = input.text.slice(
          input.triggerState.caretOffset + consumed
        );
        const newText = before + "#" + kw + " " + after;

        dismissedRef.current = false;
        setPickerIndex(0);

        const expandedState: TriggerState = {
          active: true,
          trigger: "#",
          subTrigger: kw,
          query: "",
          caretOffset: input.triggerState.caretOffset,
        };
        setTriggerState(expandedState);

        return { text: newText, triggerState: expandedState };
      }

      if (input.triggerState.subTrigger === undefined && input.item.value === "switch") {
        const before = input.text.slice(0, input.triggerState.caretOffset);
        const consumed = getConsumedLength(input.triggerState);
        const after = input.text.slice(
          input.triggerState.caretOffset + consumed
        );
        const newText = before + "#switch " + after;

        dismissedRef.current = false;
        setPickerIndex(0);

        const expandedState: TriggerState = {
          active: true,
          trigger: "#",
          subTrigger: "switch",
          query: "",
          caretOffset: input.triggerState.caretOffset,
        };
        setTriggerState(expandedState);

        return { text: newText, triggerState: expandedState };
      }

      const result = await resolveItem(input);

      dismissedRef.current = false;
      setTriggerState(NO_TRIGGER);
      setPickerIndex(0);

      return result;
    },
    [getConsumedLength, resolveItem]
  );

  // ── Handler: close picker (Escape) ──────────────────────────────

  const handleClose = useCallback(() => {
    dismissedRef.current = true;
    suppressTriggerRef.current = true;
    setTriggerState(NO_TRIGGER);
    setPickerIndex(0);
  }, []);

  // ── Handler: reset (send, etc.) ─────────────────────────────────

  const reset = useCallback(() => {
    dismissedRef.current = false;
    suppressTriggerRef.current = false;
    setTriggerState(NO_TRIGGER);
    setPickerIndex(0);
  }, []);

  // ── Keyboard handler registration (for ContextPicker) ────────────

  const registerKeyHandler = useCallback(
    (handler: ((e: KeyboardEvent) => void) | null) => {
      pickerKeyDownRef.current = handler;
    },
    []
  );

  return {
    triggerState,
    pickerIndex,
    setPickerIndex,
    handleChange,
    handleSelect,
    handleClose,
    reset,
    pickerKeyDownRef,
    registerKeyHandler,
  };
}
