// src/platform/terminal.ts

import type { Disposable } from "./types";

/** ターミナル API インターフェース */
export interface TerminalAPI {
  createTerminal(options: {
    name?: string;
    cwd?: string;
    command?: string;
    args?: string[];
  }): Terminal;
}

export interface Terminal {
  id: string;
  show(): void;
  sendText(text: string): void;
  getOutput(): Promise<string>;
  waitForExit(): Promise<number>;
  kill(): void;
  dispose(): void;
}
