#!/usr/bin/env bun

import { colors } from "./cli/logger";
import { build, serve } from "bun";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { init } from "./cli"; 
 
 
import { logger, timedStep } from "./cli/logger";

 

// --- CONSTANTS ---

const PROJECT_ROOT = process.cwd();
const APP_DIR = path.join(PROJECT_ROOT, "app");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const VADER_SRC_PATH = path.join(PROJECT_ROOT, "node_modules", "vaderjs-native", "index.ts");
const TEMP_SRC_DIR = path.join(PROJECT_ROOT, ".vader_temp_src");


// --- CONFIG & PLUGIN SYSTEM ---

let config = {};
let htmlInjections = [];

const vaderAPI = {
  runCommand: async (cmd) => {
    if (typeof cmd === "string") cmd = cmd.split(" ");
    const p = Bun.spawn(cmd);
    await p.exited;
  },
  injectHTML: (content) => htmlInjections.push(content),
  log: (msg) => logger.info(`[Plugin] ${msg}`),
  getProjectRoot: () => PROJECT_ROOT,
  getDistDir: () => DIST_DIR,
  getPublicDir: () => PUBLIC_DIR,
};

export async function loadConfig(projectDir) {
  projectDir = projectDir || process.cwd();
  const configPathTs = path.join(projectDir, "vaderjs.config.ts");
  const configPathJs = path.join(projectDir, "vaderjs.config.js");
  let userConfig = {};
  if (fsSync.existsSync(configPathTs)) {
    userConfig = (await import(`file://${configPathTs}`)).default;
  } else if (fsSync.existsSync(configPathJs)) {
    userConfig = (await import(`file://${configPathJs}`)).default;
  }
  return userConfig;
}

export function defineConfig(config) {
  return config;
}

async function runPluginHook(hookName) {
  if (!config.plugins) return;
  for (const plugin of config.plugins) {
    if (typeof plugin[hookName] === "function") {
      try {
        await plugin[hookName](vaderAPI);
      } catch (e) {
        logger.error(`Plugin hook error (${hookName} in ${plugin.name || 'anonymous'}):`, e);
      }
    }
  }
}



// --- BUILD LOGIC ---

/**
 * Step 1: Transpile and bundle the core vaderjs library.
 */
async function buildVaderCore() {
  if (!fsSync.existsSync(VADER_SRC_PATH)) {
    logger.error("VaderJS source not found:", VADER_SRC_PATH);
    throw new Error("Missing vaderjs dependency.");
  }

  await build({
    entrypoints: [VADER_SRC_PATH],
    outdir: path.join(DIST_DIR, "src", "vader"),
    target: "browser",
    minify: false,
    sourcemap: "external",
    jsxFactory: "e",
    jsxFragment: "Fragment",
    jsxImportSource: "vaderjs",
  });
}

/**
 * Step 2: Patches source code to remove server-side hook imports.
 */
function patchHooksUsage(code) {
  return code.replace(/import\s+{[^}]*use(State|Effect|Memo|Navigation)[^}]*}\s+from\s+['"]vaderjs['"];?\n?/g, "");
}
function publicAssetPlugin() {
  return {
    name: "public-asset-replacer",
    setup(build) {
      build.onLoad({ filter: /\.(js|ts|jsx|tsx|html)$/ }, async (args) => {
        let code = await fs.readFile(args.path, "utf8");

        code = code.replace(/\{\{public:(.+?)\}\}/g, (_, relPath) => {
          const absPath = path.join(PUBLIC_DIR, relPath.trim());
          if (fsSync.existsSync(absPath)) {
            return "/" + relPath.trim().replace(/\\/g, "/");
          }
          logger.warn(`Public asset not found: ${relPath}`);
          return relPath;
        });

        return {
          contents: code,
          loader: args.path.endsWith(".html")
            ? "text"
            : args.path.endsWith(".tsx")
              ? "tsx"
              : args.path.endsWith(".jsx")
                ? "jsx"
                : args.path.endsWith(".ts")
                  ? "ts"
                  : "js",
        };
      });
    },
  };
}

/**
 * Step 3: Pre-processes all files in `/src` into a temporary directory.
 */

async function preprocessSources(srcDir, tempDir) {
  await fs.mkdir(tempDir, { recursive: true });
  for (const entry of await fs.readdir(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(tempDir, entry.name);

    if (entry.isDirectory()) {
      await preprocessSources(srcPath, destPath);
    } else if (/\.(tsx|jsx|ts|js)$/.test(entry.name)) {
      let content = await fs.readFile(srcPath, "utf8");
      content = patchHooksUsage(content);
      await fs.writeFile(destPath, content);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Step 4: Build the application's source code from the preprocessed temp directory.
 */
async function buildSrc() {
  if (!fsSync.existsSync(SRC_DIR)) return;

  if (fsSync.existsSync(TEMP_SRC_DIR)) {
    await fs.rm(TEMP_SRC_DIR, { recursive: true, force: true });
  }
  await preprocessSources(SRC_DIR, TEMP_SRC_DIR);

  const entrypoints = fsSync.readdirSync(TEMP_SRC_DIR, { recursive: true })
    .map(file => path.join(TEMP_SRC_DIR, file))
    .filter(file => /\.(ts|tsx|js|jsx)$/.test(file));

  if (entrypoints.length === 0) {
    logger.info("No source files found in /src to build.");
    return;
  }

  await build({
    entrypoints,
    outdir: path.join(DIST_DIR, "src"),
    root: TEMP_SRC_DIR,
    naming: { entry: "[dir]/[name].js" },
    jsxFactory: "e",
    jsxFragment: "Fragment",
    jsxImportSource: "vaderjs-native",
    target: "browser",
    minify: false,
    plugins: [
      publicAssetPlugin(),
    ],
    external: ["vaderjs-native"],
  });
}

/**
 * Step 5: Copy all assets from the `/public` directory to `/dist`.
 */
async function copyPublicAssets() {
  if (!fsSync.existsSync(PUBLIC_DIR)) return;
  // Copy contents of public into dist, not the public folder itself
  for (const item of await fs.readdir(PUBLIC_DIR)) {
    await fs.cp(path.join(PUBLIC_DIR, item), path.join(DIST_DIR, item), { recursive: true });
  }
}

async function buildAppEntrypoints(isDev = false) {
  if (!fsSync.existsSync(APP_DIR)) {
    logger.warn("No '/app' directory found, skipping app entrypoint build.");
    return;
  }

  if (!fsSync.existsSync(DIST_DIR)) {
    await fs.mkdir(DIST_DIR, { recursive: true });
  }

  const devClientScript = isDev
    ? `<script>
        new WebSocket("ws://" + location.host + "/__hmr").onmessage = (msg) => {
          if (msg.data === "reload") location.reload();
        };
      </script>`
    : "";

  const entries = fsSync.readdirSync(APP_DIR, { recursive: true })
    .filter(file => /index\.(jsx|tsx)$/.test(file))
    .map(file => ({
      name: path.dirname(file) === '.' ? 'index' : path.dirname(file).replace(/\\/g, '/'),
      path: path.join(APP_DIR, file)
    }));

  // Helper to resolve any asset path from /public
  function resolvePublicPath(p) {
    const assetPath = p.replace(/^(\.\/|\/)/, ""); // strip leading ./ or /
    const absPath = path.join(PUBLIC_DIR, assetPath);
    if (fsSync.existsSync(absPath)) {
      return "/" + assetPath.replace(/\\/g, "/");
    }
    return p; // leave unchanged if not in public
  }

  for (const { name, path: entryPath } of entries) {
    const outDir = path.join(DIST_DIR, name === 'index' ? '' : name);
    const outJsPath = path.join(outDir, 'index.js');
    await fs.mkdir(outDir, { recursive: true });

    // --- CSS HANDLING ---
    const cssLinks = [];
    let content = await fs.readFile(entryPath, "utf8");
    const cssImports = [...content.matchAll(/import\s+['"](.*\.css)['"]/g)];
    for (const match of cssImports) {
      const cssImportPath = match[1];
      const sourceCssPath = path.resolve(path.dirname(entryPath), cssImportPath);
      if (fsSync.existsSync(sourceCssPath)) {
        const relativeCssPath = path.relative(APP_DIR, sourceCssPath);
        const destCssPath = path.join(DIST_DIR, relativeCssPath);
        await fs.copyFile(sourceCssPath, destCssPath);
        const htmlRelativePath = path.relative(outDir, destCssPath).replace(/\\/g, '/');
        cssLinks.push(`<link rel="stylesheet" href="${htmlRelativePath}">`);
      } else {
        logger.warn(`CSS file not found: ${sourceCssPath}`);
      }
    }

    // --- HTML GENERATION ---
    let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>VaderJS App - ${name}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${cssLinks.join("\n  ")}
  ${htmlInjections.join("\n  ")}
</head>
<body>
  <div id="app"></div>
  <script  src="./index.js"></script>
  ${devClientScript}
</body>
</html>`;

    // --- FIX ASSET PATHS IN HTML ---
    htmlContent = htmlContent.replace(
      /(["'(])([^"'()]+?\.(png|jpe?g|gif|svg|webp|ico))(["')])/gi,
      (match, p1, assetPath, ext, p4) => p1 + resolvePublicPath(assetPath) + p4
    );

    await fs.writeFile(path.join(outDir, "index.html"), htmlContent);

    // --- JS BUILD ---
    await build({
      entrypoints: [entryPath],
      outdir: outDir,
      target: "browser",
      minify: false,
      sourcemap: "external",
      jsxFactory: "Vader.createElement",
      jsxFragment: "Fragment",
      plugins: [
        publicAssetPlugin(),
      ],
      loader: {
        '.js': 'jsx',
        '.ts': 'tsx',
        '.css': 'text',
      }
    });

    // --- FIX IMPORT PATHS IN JS ---
    let jsContent = await fs.readFile(outJsPath, "utf8");
    const vaderSource = await fs.readFile(VADER_SRC_PATH, "utf8");
    // Vader import fix 

    // Asset path fix for JS
    jsContent = jsContent.replace(
      /import\s+\*\s+as\s+Vader\s+from\s+['"]vaderjs['"];?/,
      vaderSource
    );

    await fs.writeFile(outJsPath, jsContent);
  }
}



export async function buildAll(isDev = false) {
  logger.info(`Starting VaderJS ${isDev ? 'development' : 'production'} build...`);
  const totalTime = performance.now();

  htmlInjections = [];

  // Ensure dist directory exists before cleaning
  if (fsSync.existsSync(DIST_DIR)) {
    await fs.rm(DIST_DIR, { recursive: true, force: true });
  }

  // Create the dist directory if it doesn't exist
  await fs.mkdir(DIST_DIR, { recursive: true });

  await runPluginHook("onBuildStart");

  // Build the components in steps and handle errors properly
  await timedStep("Building VaderJS Core", buildVaderCore);
  await timedStep("Building App Source (/src)", buildSrc);
  await timedStep("Copying Public Assets", copyPublicAssets);
  await timedStep("Building App Entrypoints (/app)", () => buildAppEntrypoints(isDev)); 
  await runPluginHook("onBuildFinish");

  // Calculate the total duration and log it
  const duration = (performance.now() - totalTime).toFixed(2);
  logger.success(`Total build finished in ${duration}ms. Output is in /dist.`);
}

import runDevServer from "./cli/web/server";
import { runProdServer } from "./cli/web/server";
 
import { androidDev  } from "./cli/android/dev.js";
import { buildAndroid } from "./cli/android/build";

// --- SCRIPT ENTRYPOINT ---

async function main() {
  const banner = `${colors.magenta}
    __     __  ____   ____   _______  __
   |  |   /  |/ __ \ / __ \ / ____/ |/ /
   |  |  /   / / / // /_/ // /___   |   / 
   |  | /   / /_/ / \____// /___  /   |  
   |____/____/_____/     /_____/ |_| |_|
  ${colors.reset}`;

  console.log(banner);


  config = await loadConfig();
  config.port = config.port || 3000;

  const command = process.argv[2];

  if (command === "dev") {
    globalThis.isDev = true
    await runDevServer("web");
  }
  else if (command === "android:dev") {
    globalThis.isDev = true
    await buildAll(true);
    await androidDev();
  }
  else if(command === "android:build"){
    await buildAll(false);
    await buildAndroid(false);
    logger.success("Android build completed 🚀");
  }
  else if (command === "build") {
    await buildAll(false);
  } else if (command === "serve") {
    await buildAll(false);
    await runProdServer();
  }
  else if (command === "init") {
    init().catch((e) => {
      console.error("Initialization failed:", e);
      process.exit(1);
    });

  } else {
    logger.error(`Unknown command: ${command}`);
    logger.info("Available commands: dev, android:dev, build, serve, init");
    process.exit(1);
  }
}

main().catch(err => {
  logger.error("An unexpected error occurred:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled Promise rejection:", err);
});
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
});