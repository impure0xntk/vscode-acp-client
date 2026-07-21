// ----------------------------------------------------------------------------
// PanelMode — UI chat-mode strategy
//
// Replaces the `panelMode === "supervisor" ? ... : ...` conditional in
// AppContainer with polymorphism. Each mode knows how to render itself and how
// to describe itself for the extension host / menus. Adding a new mode is a
// matter of adding a new strategy class -- no call-site changes required.
// ----------------------------------------------------------------------------

import type { ReactElement } from "react";
import { UnifiedMode, type UnifiedModeProps } from "./unified/UnifiedMode";
import {
  SupervisorMode,
  type SupervisorModeProps,
} from "./supervisor/SupervisorMode";

/** Props common to every mode component. */
export interface PanelModeProps extends Omit<UnifiedModeProps, "onSendMode"> {
  onSendMode?: (
    text: string,
    attachments: import("../../types").ContextAttachment[]
  ) => void;
}

export interface PanelModeStrategy {
  /** Stable identifier, used for persistence and messages. */
  readonly id: "unified" | "supervisor";
  /** Human-readable label for menus / status. */
  readonly label: string;
  /** Whether this mode shows the mesh/supervisor surface. */
  readonly showsMesh: boolean;
  /** Render the mode's root component. */
  render(props: PanelModeProps): ReactElement;
}

class UnifiedPanelMode implements PanelModeStrategy {
  readonly id = "unified" as const;
  readonly label = "Unified";
  readonly showsMesh = false;

  render(props: PanelModeProps): ReactElement {
    const { onSendMode, ...rest } = props;
    return (
      <UnifiedMode {...(rest as UnifiedModeProps)} onSendMode={onSendMode} />
    );
  }
}

class SupervisorPanelMode implements PanelModeStrategy {
  readonly id = "supervisor" as const;
  readonly label = "Supervisor";
  readonly showsMesh = true;

  render(props: PanelModeProps): ReactElement {
    return <SupervisorMode {...(props as SupervisorModeProps)} />;
  }
}

const STRATEGIES: Record<"unified" | "supervisor", PanelModeStrategy> = {
  unified: new UnifiedPanelMode(),
  supervisor: new SupervisorPanelMode(),
};

export type PanelModeId = keyof typeof STRATEGIES;

/** Return the strategy for a given mode id (defaults to unified). */
export function getPanelMode(
  id: "unified" | "supervisor" = "unified"
): PanelModeStrategy {
  return STRATEGIES[id] ?? STRATEGIES.unified;
}

/** All known modes, e.g. for building menus. */
export function listPanelModes(): readonly PanelModeStrategy[] {
  return Object.values(STRATEGIES);
}
