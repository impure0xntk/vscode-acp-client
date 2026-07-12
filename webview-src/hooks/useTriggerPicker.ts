import {
  useState,
  useRef,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { SuggestionItem, TriggerType } from "../types";

const TRIGGER_CHARS: TriggerType[] = ["/", "#", "@"];

function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 10 || code === 13 || code === 9;
}

function splitByWhitespace(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = s.length;
  while (i < len) {
    while (i < len && isWhitespace(s.charCodeAt(i))) i++;
    if (i >= len) break;
    const start = i;
    while (i < len && !isWhitespace(s.charCodeAt(i))) i++;
    tokens.push(s.slice(start, i));
  }
  return tokens;
}

/** Trim leading whitespace without regex */
function trimLeft(s: string): string {
  let i = 0;
  while (i < s.length && isWhitespace(s.charCodeAt(i))) i++;
  return s.slice(i);
}

export interface TriggerState {
  active: boolean;
  trigger: TriggerType;
  query: string;
  caretOffset: number;
  subTrigger?: "symbol" | "file" | "switch" | "team" | "output" | "turn";
  /** Multi-@ mode: picker stays open after selecting a session */
  multiMode?: boolean;
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
    subTrigger?: "symbol" | "file" | "switch" | "team" | "output" | "turn"
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
  pickerKeyDownRef: React.MutableRefObject<
    ((e: ReactKeyboardEvent<HTMLTextAreaElement>) => void) | null
  >;
  registerKeyHandler: (
    handler: ((e: ReactKeyboardEvent<HTMLTextAreaElement>) => void) | null
  ) => void;
}

export function useTriggerPicker(
  options: UseTriggerPickerOptions
): UseTriggerPickerReturn {
  const { fetchSuggestions, resolveItem } = options;

  const [triggerState, setTriggerState] = useState<TriggerState>(NO_TRIGGER);
  const [pickerIndex, setPickerIndex] = useState(0);

  const suppressTriggerRef = useRef(false);
  const dismissedRef = useRef(false);
  const pickerKeyDownRef = useRef<
    ((e: ReactKeyboardEvent<HTMLTextAreaElement>) => void) | null
  >(null);

  const getConsumedLength = useCallback((ts: ConsumedLengthInput): number => {
    if (ts.trigger === "/") return 1 + ts.query.length;
    if (ts.trigger === "@") {
      if (ts.subTrigger) {
        const base = 1 + ts.subTrigger.length + 1;
        return ts.query.length > 0 ? base + ts.query.length : base;
      }
      return 1 + ts.query.length;
    }
    if (ts.subTrigger) {
      const base = 1 + ts.subTrigger.length;
      return ts.query.length > 0 ? base + 1 + ts.query.length : base;
    }
    return 1 + ts.query.length;
  }, []);

  const detectTrigger = useCallback(
    (value: string, caretPos: number): TriggerState => {
      const charTyped = caretPos > 0 ? value.charCodeAt(caretPos - 1) : 0;

      if (dismissedRef.current) {
        if (
          charTyped !== 0 &&
          (TRIGGER_CHARS as string[]).includes(value[caretPos - 1])
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
        const afterTriggerCodePoints = afterTrigger.length;

        let hasWhitespace = false;
        for (let i = 0; i < afterTriggerCodePoints; i++) {
          if (isWhitespace(afterTrigger.charCodeAt(i))) {
            hasWhitespace = true;
            break;
          }
        }

        if (ch === "/") {
          if (hasWhitespace) continue;
          return {
            active: true,
            trigger: ch,
            query: afterTrigger,
            caretOffset: idx,
          };
        }

        if (ch === "@") {
          if (idx > 0 && isWordChar(beforeCaret.charCodeAt(idx - 1))) continue;
          if (hasWhitespace) continue;

          const teamPrefix = "team:";
          if (afterTrigger.toLowerCase().startsWith(teamPrefix)) {
            const teamQuery = afterTrigger.slice(teamPrefix.length);
            return {
              active: true,
              trigger: "@",
              subTrigger: "team",
              query: teamQuery,
              caretOffset: idx,
            };
          }

          return {
            active: true,
            trigger: "@",
            query: afterTrigger,
            caretOffset: idx,
            multiMode: triggerState.multiMode,
          };
        }

        const tokens = splitByWhitespace(afterTrigger);

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
          const rest = trimLeft(afterTrigger.slice(first.length));
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
          const rest = trimLeft(afterTrigger.slice("switch".length));
          return {
            active: true,
            trigger: "#",
            subTrigger: "switch",
            query: rest,
            caretOffset: idx,
          };
        }

        // `#output` / `#turn` → pick a previous turn's final response as a
        // context attachment. Mirrors the `switch` subcommand: one keyword,
        // optional trailing query that filters the turn list.
        if (first === "output" || first === "turn") {
          if (tokens.length === 1) {
            return {
              active: true,
              trigger: "#",
              subTrigger: first,
              query: "",
              caretOffset: idx,
            };
          }
          const rest = trimLeft(afterTrigger.slice(first.length));
          return {
            active: true,
            trigger: "#",
            subTrigger: first,
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

  const handleChange = useCallback(
    (value: string, caretPos: number): TriggerState => {
      const newTrigger = detectTrigger(value, caretPos);
      setTriggerState(newTrigger);
      return newTrigger;
    },
    [detectTrigger]
  );

  const handleSelect = useCallback(
    async (input: SelectInput): Promise<SelectOutput> => {
      suppressTriggerRef.current = true;

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

      if (
        input.triggerState.subTrigger === undefined &&
        input.item.kind === "turn"
      ) {
        // `#output` / `#turn` subcommands: expand to the turn picker
        // (mirrors the file/symbol expansion above).  `value` carries the
        // actual keyword ("output" | "turn") since both share kind "turn".
        const kw = input.item.value;
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
          subTrigger: kw as TriggerState["subTrigger"],
          query: "",
          caretOffset: input.triggerState.caretOffset,
        };
        setTriggerState(expandedState);

        return { text: newText, triggerState: expandedState };
      }

      if (
        input.triggerState.subTrigger === undefined &&
        input.item.value === "switch"
      ) {
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

      if (input.triggerState.multiMode && input.item.kind === "session") {
        dismissedRef.current = false;
        setPickerIndex(0);
        const keepOpenState: TriggerState = {
          ...input.triggerState,
          active: false,
          query: "",
        };
        setTriggerState(keepOpenState);
        return result;
      }

      dismissedRef.current = false;
      setTriggerState(NO_TRIGGER);
      setPickerIndex(0);

      return result;
    },
    [getConsumedLength, resolveItem]
  );

  const handleClose = useCallback(() => {
    dismissedRef.current = true;
    suppressTriggerRef.current = true;
    setTriggerState(NO_TRIGGER);
    setPickerIndex(0);
  }, []);

  const reset = useCallback(() => {
    dismissedRef.current = false;
    suppressTriggerRef.current = false;
    setTriggerState(NO_TRIGGER);
    setPickerIndex(0);
  }, []);

  const registerKeyHandler = useCallback(
    (
      handler: ((e: ReactKeyboardEvent<HTMLTextAreaElement>) => void) | null
    ) => {
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
