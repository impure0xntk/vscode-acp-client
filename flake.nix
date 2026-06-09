{
  description = "vscode-acp-client - ACP-compatible VS Code extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_24;

      in {
        # Development shell
        devShells.default = pkgs.mkShell {
          name = "vscode-acp-client-dev";

          buildInputs = [
            # Core runtime
            nodejs
            pkgs.typescript

            # Tooling
            pkgs.nixpkgs-fmt
            pkgs.nil
            pkgs.git
          ];

          shellHook = ''
            # Run npm install if node_modules is missing
            if [ ! -d node_modules ]; then
              echo "Running npm install..."
              npm install
            fi

            echo "╔══════════════════════════════════════════════════════════╗"
            echo "║  vscode-acp-client dev shell                            ║"
            echo "╠══════════════════════════════════════════════════════════╣"
            printf "║  Node:     %-44s ║\n" "$(node --version)"
            printf "║  npm:      %-44s ║\n" "$(npm --version)"
            printf "║  tsc:      %-44s ║\n" "$(tsc --version 2>/dev/null || echo 'run tsc after npm install')"
            echo "╠══════════════════════════════════════════════════════════╣"
            echo "║  Setup (first time):                                     ║"
            echo "║    npm install         - Install dependencies            ║"
            echo "╠══════════════════════════════════════════════════════════╣"
            echo "║  Development:                                            ║"
            echo "║    npm run compile    - Compile TypeScript + webview      ║"
            echo "║    npm run watch      - Watch mode (tsc + esbuild)       ║"
            echo "║    npm run typecheck  - Type check only                  ║"
            echo "║    npm run lint       - Lint source                      ║"
            echo "║    npm run format     - Format with prettier             ║"
            echo "║    npm test           - Run extension tests              ║"
            echo "║    npm run package    - Package extension (.vsix)        ║"
            echo "╚══════════════════════════════════════════════════════════╝"
          '';
        };

        formatter = pkgs.nixpkgs-fmt;
      }
    );
}
