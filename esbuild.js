const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const postcss = require("postcss");

const isWatch = process.argv.includes("--watch");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function processCss(inputFile, outputFile) {
  const css = fs.readFileSync(inputFile, "utf8");
  const postcssConfig = require("./postcss.config.js");
  const result = await postcss(postcssConfig.plugins).process(css, {
    from: inputFile,
    to: outputFile,
  });
  ensureDir(path.dirname(outputFile));
  fs.writeFileSync(outputFile, result.css);
  if (result.map) {
    fs.writeFileSync(`${outputFile}.map`, result.map.toString());
  }
  console.log(`CSS build complete: ${outputFile}`);
}

/**
 * esbuild plugin: alias webview-src/lib/path → src/shared/util/path
 * so the webview bundle uses the canonical implementation (DRY).
 */
function aliasPathPlugin() {
  const webviewSrcDir = path.join(__dirname, "webview-src");
  const canonicalPath = path.join(
    __dirname,
    "src",
    "shared",
    "util",
    "path.ts"
  );

  return {
    name: "alias-path",
    setup(build) {
      // Match imports ending with "lib/path" (e.g. "./lib/path", "../../lib/path")
      // but only when the importer is inside webview-src/.
      const filter = /lib[\\/]path$/;

      build.onResolve({ filter }, (args) => {
        if (!args.resolveDir.startsWith(webviewSrcDir)) return;
        return { path: canonicalPath };
      });
    },
  };
}

const common = {
  bundle: true,
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": '"development"',
  },
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
    ".svg": "file",
    ".png": "file",
  },
};

const webviewBuild = {
  ...common,
  entryPoints: [path.join(__dirname, "webview-src", "index.tsx")],
  outfile: path.join(__dirname, "dist", "webview.js"),
  format: "iife",
  globalName: "acpWebview",
  plugins: [aliasPathPlugin()],
  // CSS is handled separately by postcss+tailwindcss above
  loader: {
    ...common.loader,
    ".css": "empty",
  },
};

// MiniChat: a lightweight webview entry that renders only the Session
// Overview + Composer (and an optional drill-down history). Shares all
// domain stores/components with the full chat so state stays in sync.
const miniChatBuild = {
  ...common,
  entryPoints: [path.join(__dirname, "webview-src", "index.mini.tsx")],
  outfile: path.join(__dirname, "dist", "webview.mini.js"),
  format: "iife",
  globalName: "acpMiniChat",
  plugins: [aliasPathPlugin()],
  loader: {
    ...common.loader,
    ".css": "empty",
  },
};

async function buildCss() {
  const input = path.join(__dirname, "webview-src", "styles", "globals.css");
  const output = path.join(__dirname, "dist", "webview.css");
  await processCss(input, output);
}

async function buildJs() {
  ensureDir(path.join(__dirname, "dist"));

  try {
    const results = await esbuild.build(webviewBuild);

    if (results.errors.length > 0) {
      console.error("Build errors:", results.errors);
      process.exit(1);
    }

    console.log("Webview build complete: dist/webview.js");
  } catch (err) {
    console.error("Build failed:", err);
    process.exit(1);
  }

  try {
    const miniResults = await esbuild.build(miniChatBuild);

    if (miniResults.errors.length > 0) {
      console.error("MiniChat build errors:", miniResults.errors);
      process.exit(1);
    }

    console.log("MiniChat build complete: dist/webview.mini.js");
  } catch (err) {
    console.error("MiniChat build failed:", err);
    process.exit(1);
  }
}

async function build() {
  await buildCss();
  await buildJs();
}

if (isWatch) {
  build().then(() => {
    console.log("Watching webview-src/ for changes...");
    fs.watch(
      path.join(__dirname, "webview-src"),
      { recursive: true },
      (_event, filename) => {
        if (filename) {
          console.log(`File changed: ${filename}, rebuilding...`);
          build();
        }
      }
    );
  });
} else {
  build();
}
