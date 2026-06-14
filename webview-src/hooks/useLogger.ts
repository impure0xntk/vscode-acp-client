// webview-src/hooks/useLogger.ts
//
// React hook that provides a Logger scoped to the calling component.
// The category is automatically set to the component name.
//
// Usage:
//   const log = useLogger("ChatContainer");
//   useEffect(() => { log.info("mounted"); }, []);

import { useRef } from "react";
import { getLogger, type Logger } from "../lib/logger";

export function useLogger(componentName: string): Logger {
  const ref = useRef<Logger | null>(null);
  if (!ref.current) {
    ref.current = getLogger(`webview.component.${componentName}`);
  }
  return ref.current;
}
