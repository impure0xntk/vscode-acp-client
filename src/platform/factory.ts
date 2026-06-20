// src/platform/factory.ts

import type { PlatformAPI } from "./platform";
import type { LogLevelValue } from "./backends/types";

export type PlatformType = "vscode" | "node" | "electron";

export interface CreatePlatformOptions {
  context?: import("vscode").ExtensionContext;
  logLevel?: LogLevelValue;
  [key: string]: unknown;
}

export async function createPlatform(
  type: PlatformType,
  options?: CreatePlatformOptions
): Promise<PlatformAPI> {
  switch (type) {
    case "vscode": {
      const { VscodePlatform } = await import("./adapters/vscode.js");
      return new VscodePlatform(
        options as { context: import("vscode").ExtensionContext }
      );
    }
    case "node": {
      throw new Error("Node platform adapter not yet implemented");
    }
    case "electron": {
      throw new Error("Electron platform adapter not yet implemented");
    }
    default:
      throw new Error(`Unsupported platform: ${type}`);
  }
}
