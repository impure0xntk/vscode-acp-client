import { useRef } from "react";
import { getLogger, type Logger } from "../lib/logger";

export function useLogger(componentName: string): Logger {
  const ref = useRef<Logger | null>(null);
  if (!ref.current) {
    ref.current = getLogger(`webview.component.${componentName}`);
  }
  return ref.current;
}
