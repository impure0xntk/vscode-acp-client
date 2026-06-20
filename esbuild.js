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
  // CSS is handled separately by postcss+tailwindcss above
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
