# AGENTS.md — vscode-acp-client

## Project Overview

VS Code extension that serves as a **universal ACP (Agent Client Protocol) client**, connecting to any ACP-compatible AI coding agent with a best-in-class chat experience. Protocol-native and agent-agnostic.

**Repository**: <https://github.com/impure0xntk/vscode-acp-client>
**License**: MIT
**Language**: TypeScript (strict mode)
**UI Framework**: React 18 + Tailwind CSS 4 (webview)

## Architecture

```text
src/
├── extension.ts                    # Entry point (delegates to infrastructure/vscode/extension.ts)
├── adapter/                        # ACP protocol adapters
│   ├── acp/client.ts              # JSON-RPC 2.0 over stdio
│   ├── agent/registry.ts          # Agent configuration
│   └── agent/status.ts            # Agent status tracking
├── application/                    # Application layer
│   ├── handlers/                  # Event handlers (message, session, task)
│   └── session/                   # Session orchestration, history, persistence
├── domain/                        # Domain models and services
│   ├── models/                    # Agent, Chat, Message, Session, Task types
│   └── services/                  # Agent registry, message router, session manager
├── infrastructure/vscode/         # VS Code-specific implementation
│   └── extension.ts               # Actual activate/deactivate
├── platform/                      # Platform abstraction layer
│   ├── adapters/vscode.ts         # VS Code platform adapter
│   └── backends/                  # Logging backends (pino, vscode-output, etc.)
└── shared/util/                   # Shared utilities

webview-src/                       # React webview UI
├── components/                    # ChatContainer, Composer, Message, ToolCallCard, etc.
├── hooks/                         # useSessionContext
├── lib/                           # markdown rendering, vscode API bridge
└── styles/globals.css             # Tailwind + VS Code CSS variable bridge
```

### Key Design Patterns

- **Domain-Driven Design**: Clear separation between domain models, application services, and infrastructure
- **Platform Abstraction**: `platform/` abstracts VS Code APIs for testability
- **Adapter Pattern**: ACP protocol handling isolated in `adapter/acp/`
- **Webview Panel**: Chat UI runs in a `WebviewPanel` (bottom panel), not a sidebar view

## Tech Stack

| Component    | Technology                               |
| ------------ | ---------------------------------------- |
| Language     | TypeScript 5.7+ (strict)                 |
| Runtime      | Node 20+, VS Code Extension Host 1.95+   |
| ACP SDK      | `@agentclientprotocol/sdk` ^0.25.0       |
| UI (Webview) | React 18 + Tailwind CSS 4                |
| Markdown     | `markdown-it` + `highlight.js`           |
| Bundler      | esbuild                                  |
| Testing      | Mocha , Vitest                                                   |
| Linting      | ESLint 9 + Prettier 3                    |

## Build & Development

### Prerequisites

Nix flake provides the dev environment:

```bash
nix develop
# or with direnv:
echo "use flake" > .envrc && direnv allow
```

### Commands

| Command             | Description                                     |
| ------------------- | ----------------------------------------------- |
| `npm run typecheck` | Type-check without emitting (`tsc --noEmit`)    |
| `npm run compile`   | Compile TypeScript + bundle webview via esbuild |
| `npm run watch`     | Watch mode (tsc + esbuild)                      |
| `npm run lint`      | ESLint                                          |
| `npm run format`    | Prettier                                        |
| `npm test`          | Run all tests (Mocha + Vitest)                  |
| `npm run package`   | Produce `.vsix` via vsce                        |
| `npm run clean`     | Remove `out/` and `dist/`                       |

### Debugging

- **Extension Host**: `F5` in VS Code (see `.vscode/launch.json`)
- **Protocol Traffic**: Enable `acp.logTraffic` setting → Output Channel
- **Webview DevTools**: Command `Developer: Open Webview Developer Tools`
- **Agent stdout/stderr**: Logged to Output Channel "ACP Agent: {name}"

## Configuration

Settings are under the `acp.` prefix:

| Setting                         | Type      | Default | Description                          |
| ------------------------------- | --------- | ------- | ------------------------------------ |
| `acp.agents`                    | `object`  | `{}`    | Agent configurations keyed by name   |
| `acp.defaultAgent`              | `string`  | `""`    | Default agent for new sessions       |
| `acp.permissions.defaultPolicy` | `string`  | `"ask"` | Default permission policy            |
| `acp.permissions.tools`         | `object`  | `{}`    | Per-tool permission overrides        |
| `acp.maxConcurrentAgents`       | `number`  | `5`     | Max concurrent agent connections     |
| `acp.showTokenUsage`            | `boolean` | `true`  | Show token usage in status bar       |
| `acp.logTraffic`                | `boolean` | `false` | Log protocol traffic                 |
| `acp.autoOpenChat`              | `boolean` | `true`  | Auto-open chat on agent connect      |
| `acp.workingDirectory`          | `string`  | `""`    | Working directory for agents         |
| `acp.context.maxFileSizeKB`     | `number`  | `100`   | Max file size for context attachment |
| `acp.context.maxTotalTokens`    | `number`  | `4000`  | Max total tokens for context         |

### Agent Configuration Schema

```jsonc
{
  "acp.agents": {
    "claude": {
      "command": "npx",
      "args": ["@agentclientprotocol/claude-agent-acp@latest"],
      "env": {},
      "autoConnect": [
        {
          "workspace": "/path/to/project",
          "sessionName": "My Session",
        },
      ],
    },
  },
}
```

## ACP Protocol Mapping

### Methods (Extension → Agent)

| ACP Method         | Trigger                          |
| ------------------ | -------------------------------- |
| `initialize`       | First connection handshake       |
| `authenticate`     | Auth challenge from agent        |
| `session/new`      | New chat session                 |
| `session/load`     | Resume existing session          |
| `session/prompt`   | Send user message + context      |
| `session/cancel`   | Cancel current turn (Escape key) |
| `session/set_mode` | Switch agent mode                |

### Notifications (Agent → Extension)

| ACP Notification                 | UI Action                |
| -------------------------------- | ------------------------ |
| `session/update` (message chunk) | Append to chat stream    |
| `session/update` (tool call)     | Render tool call card    |
| `session/update` (thought)       | Append to thinking block |
| `session/update` (plan)          | Render plan/roadmap      |

### Client Methods (Agent → Extension)

| Client Method        | Implementation                 |
| -------------------- | ------------------------------ |
| `fs/read_text_file`  | `vscode.workspace.fs.readFile` |
| `fs/write_text_file` | Write with permission check    |
| `terminal/create`    | `vscode.window.createTerminal` |
| `terminal/output`    | Terminal output capture        |
| `terminal/kill`      | Process termination            |

## Multi-Agent Architecture

- **1 Agent = 1 Connection** (stdio process)
- **1 Agent = N Sessions** (multiple `session/new` calls per connection)
- **SessionOrchestrator** manages `Map<agentId, Map<sessionId, SessionInfo>>`
- **Active session** is tracked per-agent
- **Tabbed UI** in the chat panel for session switching

## Commands

| Command            | ID                     | Description                |
| ------------------ | ---------------------- | -------------------------- |
| Open Chat          | `acp.openChat`         | Open/focus the chat panel  |
| Connect            | `acp.connect`          | Connect to an agent        |
| Disconnect         | `acp.disconnect`       | Disconnect from agent      |
| New Session        | `acp.newSession`       | Start new session          |
| Switch Session     | `acp.switchSession`    | Switch to existing session |
| Cancel Turn        | `acp.cancelTurn`       | Cancel current turn        |
| Attach File        | `acp.attachFile`       | Attach file to prompt      |
| Attach Selection   | `acp.attachSelection`  | Attach selection to prompt |
| Attach Diff        | `acp.attachDiff`       | Attach git diff to prompt  |
| Set Mode           | `acp.setMode`          | Change agent mode          |
| Show Traffic       | `acp.showTraffic`      | Open protocol traffic log  |
| Fork Session       | `acp.forkSession`      | Fork current session       |
| Show History       | `acp.showHistory`      | Show session history       |
| Clear History      | `acp.clearHistory`     | Clear session history      |
| Close All Sessions | `acp.closeAllSessions` | Close all sessions         |

## Keyboard Shortcuts

| Shortcut                       | Action                                 |
| ------------------------------ | -------------------------------------- |
| `Ctrl+Shift+N` / `Cmd+Shift+N` | New session (when connected)           |
| `Escape`                       | Cancel current turn (when turn active) |

## Implementation Phases

| Phase | Status      | Description                                       |
| ----- | ----------- | ------------------------------------------------- |
| 0     | Done        | Project scaffolding                               |
| 1     | Done        | Core ACP protocol (JSON-RPC over stdio)           |
| 2     | In Progress | Chat panel UI (React webview)                     |
| 3     | Planned     | Rich chat, session management, multi-agent        |
| 4     | Planned     | Context attachment (`#file`,`#selection`,`#diff`) |
| 5     | Planned     | Auto-attach context (open tabs, diagnostics)      |
| 5.5   | Planned     | Multi-agent orchestration (fan-out, supervisor)   |
| 6     | Planned     | Permissions & terminal integration                |
| 7     | Planned     | Polish & production                               |
| 8     | Planned     | Editor integration (Quick Fix, Code Lens, diff)   |
| 9     | Planned     | Multi-file edit review                            |
| 10    | Stretch     | ACP-native inline completion                      |

## Coding Conventions

### TypeScript

- Strict mode enabled — no `any` without justification
- Prefer `interface` for domain types, `type` for unions/aliases
- Use `readonly` for immutable data structures
- Return types on public methods

### File Organization

- Domain models in `src/domain/models/`
- Application services in `src/domain/services/` and `src/application/`
- VS Code-specific code in `src/infrastructure/vscode/` and `src/platform/`
- Webview components in `webview-src/components/`
- One component per file, co-located with tests when possible

### Naming

- PascalCase for types, classes, React components
- camelCase for functions, variables, methods
- UPPER_SNAKE for constants
- Event handlers: `onEventName` (e.g., `onSessionUpdate`)
- Boolean variables: `is/has/should` prefix (e.g., `isConnected`)

### Comments

- Explain **why**, not **what**
- No chronological logs or diff markers in source
- No `// TODO: restore` or `// ... existing code ...` placeholders
- JSDoc for public API surfaces

### Imports

- Group: external → internal → relative
- Use path aliases defined in tsconfig
- Barrel exports via `index.ts` for module boundaries

## Testing

- **Test runner**: Mocha, Vitest (`vitest.config.ts`)
- **Test environment**: jsdom
- **Setup file**: `webview-src/test/setup.ts` (loads `@testing-library/jest-dom` matchers)
- **Suite (core/integration) tests**: `src/test/suite/*.test.ts` + `webview-src/test/suite/*.test.ts`
- **UI (component) tests**: `webview-src/test/ui/*.test.tsx`
- **Run command**: `npm test` (runs `test:core`, `test:webview` then `test:vitest`)
- Integration: manual smoke tests against real agents
- Protocol compliance: mock ACP server

## Verification After Every Change

After modifying your code, always run the following three commands in order and ensure they all pass before proceeding.

```bash
npm run typecheck   # 1. TypeScript type check
npm run compile     # 2. Compile + webview bundle
npm test            # 3. Run test suite
```

- **Proceed with everything in green** — If any of them fail, fix it immediately and rerun.

- Do not move on to the next task with a failed test.

- Run `npm run lint` and `npm run format` before submitting a pull request.

## VS Code Theme Integration

Webview uses CSS variables bridged from VS Code:

```css
:root {
  --bg: var(--vscode-editor-background);
  --fg: var(--vscode-editor-foreground);
  --accent: var(--vscode-focusBorder);
  --border: var(--vscode-panel-border);
}
````

These are consumed by Tailwind utility classes via config.

## Context Attachment

The primary differentiator. Supported triggers:

| Trigger                       | Behavior                                      |
| ----------------------------- | --------------------------------------------- |
| `#file`                       | File picker, attaches full file               |
| `#file:10-20`                 | Attaches specific line range                  |
| `#selection`                  | Current editor selection                      |
| `#symbol`                     | Symbol definition via VS Code symbol provider |
| `#diff`                       | Current git diff                              |
| `#terminal`                   | Last terminal output                          |
| Drag & drop                   | File drop into chat                           |
| Right-click → "Send to Agent" | Context menu on files/selections              |

Context is rendered as **collapsible chips** above the chat input showing file path, line range, token estimate, and remove button.

## Session Management

- Sessions are persisted via `globalState` / `workspaceState`
- History store tracks: sessionId, agentId, title, timestamps, message count, token usage
- Session forking creates a new session from an existing conversation
- Cross-agent session list in sidebar tree view

## Permission Model

Three-tier policy:

| Policy     | Behavior                                  |
| ---------- | ----------------------------------------- |
| `ask`      | Show permission dialog for each tool call |
| `allowAll` | Auto-approve all tool calls               |
| `denyAll`  | Deny all tool calls                       |

Per-tool overrides via `acp.permissions.tools`.

## Dependencies

### Runtime

- `@agentclientprotocol/sdk` — Official ACP SDK
- `clsx` — Conditional class names
- `path-shorten` — Path display shortening
- `sql.js` — SQLite for session history (WASM)

### Dev

- `typescript`, `esbuild`, `@vscode/vsce`, `@vscode/test-electron`
- `react`, `react-dom` + types
- `markdown-it`, `highlight.js`, `dompurify` + types
- `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `autoprefixer`
- `vitest`, `@vitest/ui`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`
- `eslint`, `prettier`, `concurrently`

## References

- DESIGN.md — Full design document with architecture diagrams
- IMPLEMENTATION_PLAN.md — Detailed phase-by-phase implementation plan
- docs/ — Additional design docs (orchestration, history, session restore, etc.)
