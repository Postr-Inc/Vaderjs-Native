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

// --- CACHE SYSTEM (Initialize first) ---
const buildCache = new Map<string, { mtime: number; hash: string }>();
const configCache = new Map<string, { config: Config; mtime: number }>();
let config: Config = {};
let htmlInjections: string[] = [];

// --- CONFIG & PLUGIN SYSTEM ---
interface VaderAPI {
  runCommand: (cmd: string | string[]) => Promise<void>;
  injectHTML: (content: string) => void;
  log: (msg: string) => void;
  getProjectRoot: () => string;
  getDistDir: () => string;
  getPublicDir: () => string;
}

const vaderAPI: VaderAPI = {
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

// Optimized config loading with cache
export async function loadConfig(projectDir?: string): Promise<Config> {
  projectDir = projectDir || process.cwd();
  const configKey = `config-${projectDir}`;
  
  const configPathTs = path.join(projectDir, "vaderjs.config.ts");
  const configPathJs = path.join(projectDir, "vaderjs.config.js");
  
  let configPath: string | null = null;
  let stat: fs.Stats | null = null;
  
  // Find which config file exists
  try {
    stat = await fs.stat(configPathTs);
    configPath = configPathTs;
  } catch {
    try {
      stat = await fs.stat(configPathJs);
      configPath = configPathJs;
    } catch {
      return {}; // No config file
    }
  }
  
  // Check cache
  if (stat && configPath) {
    const cached = configCache.get(configKey);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.config;
    }
    
    // Load config
    const userConfig = (await import(`file://${configPath}`)).default;
    configCache.set(configKey, { config: userConfig, mtime: stat.mtimeMs });
    return userConfig;
  }
  
  return {};
}

export function defineConfig(config: Config): Config {
  return config;
}

async function runPluginHook(hookName: string): Promise<void> { 
  if (!config.plugins) return;
  
  const pluginPromises = config.plugins.map(async (plugin) => {
    if (typeof plugin[hookName] === "function") {
      try {
        await plugin[hookName](vaderAPI);
      } catch (e) {
        logger.error(`Plugin hook error (${hookName} in ${plugin.name || 'anonymous'}):`, e);
      }
    }
  });
  
  await Promise.all(pluginPromises);
}

// --- OPTIMIZED BUILD HELPERS ---

// File hashing for cache invalidation
async function getFileHash(filepath: string): Promise<string> {
  const content = await fs.readFile(filepath);
  return Bun.hash(content).toString(16);
}

// Check if file needs rebuild
async function needsRebuild(sourcePath: string, destPath: string): Promise<boolean> {
  try {
    const [sourceStat, destStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(destPath).catch(() => null)
    ]);
    
    if (!destStat) return true;
    
    const cacheKey = `${sourcePath}:${destPath}`;
    const cached = buildCache.get(cacheKey);
    
    if (cached && cached.mtime === sourceStat.mtimeMs) {
      return false;
    }
    
    // Check if content changed
    const hash = await getFileHash(sourcePath);
    if (cached && cached.hash === hash) {
      buildCache.set(cacheKey, { mtime: sourceStat.mtimeMs, hash });
      return false;
    }
    
    return true;
  } catch {
    return true;
  }
}

// Parallel file operations
async function parallelForEach<T>(
  items: T[],
  callback: (item: T, index: number) => Promise<void>,
  concurrency = 4
): Promise<void> {
  const chunks = [];
  for (let i = 0; i < items.length; i += concurrency) {
    chunks.push(items.slice(i, i + concurrency));
  }
  
  for (const chunk of chunks) {
    await Promise.all(chunk.map((item, index) => callback(item, index)));
  }
}

// --- BUILD LOGIC ---

/**
 * Step 1: Transpile and bundle the core vaderjs library (cached)
 */
async function buildVaderCore(): Promise<void> {
  if (!fsSync.existsSync(VADER_SRC_PATH)) {
    logger.error("VaderJS source not found:", VADER_SRC_PATH);
    throw new Error("Missing vaderjs dependency.");
  }

  const outDir = path.join(DIST_DIR, "src", "vader");
  const mainOutput = path.join(outDir, "index.js");
  
  // Check if rebuild is needed
  if (!(await needsRebuild(VADER_SRC_PATH, mainOutput))) {
    logger.info("VaderJS Core is up to date");
    return;
  }

  await fs.mkdir(outDir, { recursive: true });
  
  await build({
    entrypoints: [VADER_SRC_PATH],
    outdir: outDir,
    target: "browser",
    minify: false,
    sourcemap: "external",
    jsxFactory: "e",
    jsxFragment: "Fragment",
    jsxImportSource: "vaderjs",
    external: [], // Bundle everything
  });
  
  // Update cache
  const stat = await fs.stat(VADER_SRC_PATH);
  const hash = await getFileHash(VADER_SRC_PATH);
  buildCache.set(`${VADER_SRC_PATH}:${mainOutput}`, { mtime: stat.mtimeMs, hash });
}

/**
 * Step 2: Patches source code to remove server-side hook imports
 */
function patchHooksUsage(code: string): string {
  return code.replace(/import\s+{[^}]*use(State|Effect|Memo|Navigation)[^}]*}\s+from\s+['"]vaderjs['"];?\n?/g, "");
}

function publicAssetPlugin() {
  const assetCache = new Map<string, string>();
  
  return {
    name: "public-asset-replacer",
    setup(build: any) {
      build.onLoad({ filter: /\.(js|ts|jsx|tsx|html)$/ }, async (args: any) => {
        const stat = await fs.stat(args.path).catch(() => null);
        if (!stat) return null;
        
        const cacheKey = `asset-${args.path}`;
        const cached = assetCache.get(cacheKey);
        if (cached && stat.mtimeMs <= (await fs.stat(args.path).catch(() => ({ mtimeMs: 0 }))).mtimeMs) {
          return { contents: cached, loader: getLoader(args.path) };
        }
        
        let code = await fs.readFile(args.path, "utf8");
        
        // Process asset paths in parallel
        const assetMatches = [...code.matchAll(/\{\{public:(.+?)\}\}/g)];
        const processedAssets = await Promise.all(
          assetMatches.map(async (match) => {
            const relPath = match[1].trim();
            const absPath = path.join(PUBLIC_DIR, relPath);
            try {
              await fs.access(absPath);
              return { match: match[0], replacement: "/" + relPath.replace(/\\/g, "/") };
            } catch {
              logger.warn(`Public asset not found: ${relPath}`);
              return { match: match[0], replacement: relPath };
            }
          })
        );
        
        for (const { match, replacement } of processedAssets) {
          code = code.replace(match, replacement);
        }
        
        assetCache.set(cacheKey, code);
        return { contents: code, loader: getLoader(args.path) };
      });
    },
  };
}

function getLoader(filepath: string): string {
  if (filepath.endsWith(".html")) return "text";
  if (filepath.endsWith(".tsx")) return "tsx";
  if (filepath.endsWith(".jsx")) return "jsx";
  if (filepath.endsWith(".ts")) return "ts";
  return "js";
}

/**
 * Step 3: Pre-processes all files in `/src` into a temporary directory (parallel)
 */
async function preprocessSources(srcDir: string, tempDir: string): Promise<void> {
  await fs.mkdir(tempDir, { recursive: true });
  
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  
  await parallelForEach(entries, async (entry) => {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(tempDir, entry.name);
    
    if (entry.isDirectory()) {
      await preprocessSources(srcPath, destPath);
    } else if (/\.(tsx|jsx|ts|js)$/.test(entry.name)) {
      const content = await fs.readFile(srcPath, "utf8");
      const processed = patchHooksUsage(content);
      await fs.writeFile(destPath, processed);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  });
}

/**
 * Step 4: Build the application's source code from the preprocessed temp directory
 */
async function buildSrc(): Promise<void> {
  if (!fsSync.existsSync(SRC_DIR)) return;
  
  // Clean temp dir if exists
  if (fsSync.existsSync(TEMP_SRC_DIR)) {
    await fs.rm(TEMP_SRC_DIR, { recursive: true, force: true });
  }
  
  await preprocessSources(SRC_DIR, TEMP_SRC_DIR);
  
  const entrypoints: string[] = [];
  function collectEntries(dir: string): void {
    const items = fsSync.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        collectEntries(fullPath);
      } else if (/\.(ts|tsx|js|jsx)$/.test(item.name)) {
        entrypoints.push(fullPath);
      }
    }
  }
  
  collectEntries(TEMP_SRC_DIR);
  
  if (entrypoints.length === 0) {
    logger.info("No source files found in /src to build.");
    return;
  }
  
  const outDir = path.join(DIST_DIR, "src");
  await fs.mkdir(outDir, { recursive: true });
  
  // Build in chunks to avoid memory issues
  const CHUNK_SIZE = 10;
  for (let i = 0; i < entrypoints.length; i += CHUNK_SIZE) {
    const chunk = entrypoints.slice(i, i + CHUNK_SIZE);
    
    await build({
      entrypoints: chunk,
      outdir: outDir,
      root: TEMP_SRC_DIR,
      naming: { entry: "[dir]/[name].js" },
      jsxFactory: "e",
      jsxFragment: "Fragment",
      jsxImportSource: "vaderjs-native",
      target: "browser",
      minify: false,
      plugins: [publicAssetPlugin()],
      external: ["vaderjs-native"],
      splitting: false, // Disable splitting for better cacheability
    });
  }
}

/**
 * Step 5: Copy all assets from the `/public` directory to `/dist` (incremental)
 */
async function copyPublicAssets(): Promise<void> {
  if (!fsSync.existsSync(PUBLIC_DIR)) return;
  
  await fs.mkdir(DIST_DIR, { recursive: true });
  
  const items = await fs.readdir(PUBLIC_DIR, { withFileTypes: true });
  
  await parallelForEach(items, async (item) => {
    const srcPath = path.join(PUBLIC_DIR, item.name);
    const destPath = path.join(DIST_DIR, item.name);
    
    if (item.isDirectory()) {
      await copyPublicAssetsRecursive(srcPath, destPath);
    } else {
      await copyIfNeeded(srcPath, destPath);
    }
  });
}

async function copyPublicAssetsRecursive(srcDir: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const items = await fs.readdir(srcDir, { withFileTypes: true });
  
  await parallelForEach(items, async (item) => {
    const srcPath = path.join(srcDir, item.name);
    const destPath = path.join(destDir, item.name);
    
    if (item.isDirectory()) {
      await copyPublicAssetsRecursive(srcPath, destPath);
    } else {
      await copyIfNeeded(srcPath, destPath);
    }
  });
}

async function copyIfNeeded(src: string, dest: string): Promise<void> {
  const cacheKey = `copy-${src}`;
  const stat = await fs.stat(src).catch(() => null);
  if (!stat) return;
  
  const cached = buildCache.get(cacheKey);
  if (cached && cached.mtime === stat.mtimeMs) {
    return;
  }
  
  await fs.copyFile(src, dest);
  buildCache.set(cacheKey, { mtime: stat.mtimeMs, hash: await getFileHash(src) });
}

/**
 * Step 6: Build app entrypoints with incremental compilation
 */
async function buildAppEntrypoints(isDev = false): Promise<void> {
  if (!fsSync.existsSync(APP_DIR)) {
    logger.warn("No '/app' directory found, skipping app entrypoint build.");
    return;
  }
  
  await fs.mkdir(DIST_DIR, { recursive: true });
  
  const devClientScript = isDev
    ? `<script>
        const ws = new WebSocket("ws://" + location.host + "/__hmr");
        ws.onmessage = (msg) => {
          if (msg.data === "reload") location.reload();
        };
        ws.onclose = () => setTimeout(() => location.reload(), 1000);
      </script>`
    : "";
  
  // Find all entrypoints
  const entrypoints: Array<{ name: string; path: string }> = [];
  function findEntrypoints(dir: string, baseDir = ""): void {
    const items = fsSync.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const relativePath = path.join(baseDir, item.name);
      
      if (item.isDirectory()) {
        findEntrypoints(fullPath, relativePath);
      } else if (item.name === "index.tsx" || item.name === "index.jsx") {
        const name = baseDir || 'index';
        entrypoints.push({ name, path: fullPath });
      }
    }
  }
  
  findEntrypoints(APP_DIR);
  
  if (entrypoints.length === 0) {
    logger.info("No app entrypoints found.");
    return;
  }
  
  // Pre-load Vader source for faster processing
  const vaderSourcePromise = fs.readFile(VADER_SRC_PATH, "utf8");
  
  // Process entrypoints in parallel
  await parallelForEach(entrypoints, async ({ name, path: entryPath }) => {
    const outDir = path.join(DIST_DIR, name === 'index' ? '' : name);
    const outJsPath = path.join(outDir, 'index.js');
    const outHtmlPath = path.join(outDir, 'index.html');
    
    // Check if rebuild is needed
    if (!isDev && !(await needsRebuild(entryPath, outJsPath))) {
      logger.info(`Entrypoint "${name}" is up to date`);
      return;
    }
    
    await fs.mkdir(outDir, { recursive: true });
    
    // --- CSS HANDLING ---
    const cssLinks: string[] = [];
    let content = await fs.readFile(entryPath, "utf8");
    const cssImports = [...content.matchAll(/import\s+['"](.*\.css)['"]/g)];
    
    await parallelForEach(cssImports, async (match) => {
      const cssImportPath = match[1];
      const sourceCssPath = path.resolve(path.dirname(entryPath), cssImportPath);
      
      try {
        await fs.access(sourceCssPath);
        const relativeCssPath = path.relative(APP_DIR, sourceCssPath);
        const destCssPath = path.join(DIST_DIR, relativeCssPath);
        
        await copyIfNeeded(sourceCssPath, destCssPath);
        const htmlRelativePath = path.relative(outDir, destCssPath).replace(/\\/g, '/');
        cssLinks.push(`<link rel="stylesheet" href="${htmlRelativePath}">`);
      } catch {
        logger.warn(`CSS file not found: ${sourceCssPath}`);
      }
    });
    
    // --- HTML GENERATION ---
    const windowsStyle = globalThis.isBuildingForWindows ? `
  <style>
  .title-bar {
    display: flex;
    justify-content: space-between;
    background: #111;
    color: white;
    -webkit-app-region: drag; 
    height: 32px;
  }
  .title-bar button {
    -webkit-app-region: no-drag; 
  }
  </style>` : '';
    
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${config.app?.name || 'VaderJS App'} - ${name}</title>
  ${cssLinks.join("\n  ")}
  ${htmlInjections.join("\n  ")}
  ${windowsStyle}
</head>
<body>
  <div id="app"></div>
  <script src="./index.js"></script>
  ${devClientScript}
</body>
</html>`;
    
    await fs.writeFile(outHtmlPath, htmlContent);
    
    // --- JS BUILD ---
    await build({
      entrypoints: [entryPath],
      outdir: outDir,
      target: "browser",
      minify: !isDev,
      sourcemap: isDev ? "inline" : "external",
      jsxFactory: "Vader.createElement",
      jsxFragment: "Fragment",
      plugins: [publicAssetPlugin()],
      loader: {
        '.js': 'jsx',
        '.ts': 'tsx',
        '.css': 'text',
      },
      define: isDev ? {
        'process.env.NODE_ENV': '"development"'
      } : {
        'process.env.NODE_ENV': '"production"'
      }
    });
    
    // --- FIX IMPORT PATHS IN JS ---
    let jsContent = await fs.readFile(outJsPath, "utf8");
    const vaderSource = await vaderSourcePromise;
    
    // Replace Vader import with actual source
    jsContent = jsContent.replace(
      /import\s+\*\s+as\s+Vader\s+from\s+['"]vaderjs['"];?/,
      vaderSource
    );
    
    await fs.writeFile(outJsPath, jsContent);
    
    // Update cache
    const stat = await fs.stat(entryPath);
    const hash = await getFileHash(entryPath);
    buildCache.set(`${entryPath}:${outJsPath}`, { mtime: stat.mtimeMs, hash });
  });
}

// --- MAIN BUILD FUNCTION ---
export async function buildAll(isDev = false): Promise<void> {
  config = await loadConfig()
  logger.info(`Starting VaderJS ${isDev ? 'development' : 'production'} build...`);
  const totalTime = performance.now();
   
  await runPluginHook("onBuildStart");
  
  // Clean dist directory only if not in dev mode or if it doesn't exist
  if (!isDev || !fsSync.existsSync(DIST_DIR)) {
    await fs.rm(DIST_DIR, { recursive: true, force: true });
    await fs.mkdir(DIST_DIR, { recursive: true });
  } else if (isDev) {
    // In dev mode, only clean if explicitly requested
    const needsClean = process.env.VADER_CLEAN === 'true';
    if (needsClean) {
      await fs.rm(DIST_DIR, { recursive: true, force: true });
      await fs.mkdir(DIST_DIR, { recursive: true });
    }
  }
   
  
  // Run build steps in optimal order with parallelization where possible
  const buildSteps = [
    { name: "Building VaderJS Core", fn: buildVaderCore },
    { name: "Building App Source (/src)", fn: buildSrc },
    { name: "Copying Public Assets", fn: copyPublicAssets },
    { name: "Building App Entrypoints (/app)", fn: () => buildAppEntrypoints(isDev) },
  ];
  
  for (const step of buildSteps) {
    await timedStep(step.name, step.fn);
  }
  
  await runPluginHook("onBuildFinish");
  
  // Cache cleanup for old entries
  if (buildCache.size > 1000) {
    const keys = Array.from(buildCache.keys()).slice(0, 500);
    for (const key of keys) {
      buildCache.delete(key);
    }
  }
  
  const duration = (performance.now() - totalTime).toFixed(2);
  logger.success(`Build completed in ${duration}ms. Output in ${DIST_DIR}`);
}

// --- IMPORTS ---
import runDevServer from "./cli/web/server";
import { runProdServer } from "./cli/web/server";
import { androidDev } from "./cli/android/dev.js";
import { buildAndroid } from "./cli/android/build";
import { buildWindows } from "vaderjs-native/cli/windows/build";
import openWinApp from "vaderjs-native/cli/windows/dev";
import { Config } from "vaderjs-native/config";

// --- SCRIPT ENTRYPOINT ---
async function main(): Promise<void> {
  // Banner
  console.log(`${colors.magenta}
    __     __  ____   ____   _______  __
   |  |   /  |/ __ \\ / __ \\ / ____/ |/ /
   |  |  /   / / / // /_/ // /___   |   / 
   |  | /   / /_/ / \\____// /___  /   |  
   |____/____/_____/     /_____/ |_| |_|
  ${colors.reset}`);
  
  // Load config with caching 
  config.port = config.port || 3000;
  
  const command = process.argv[2];
  const env = process.env.NODE_ENV || 'development';
  
  // Set global flags
  globalThis.isDev = command?.includes('dev') || false;
  globalThis.isBuildingForWindows = command?.includes('windows') || false;
  
  // Command router
  const commandHandlers: Record<string, () => Promise<void>> = {
    'dev': async () => {
      await runDevServer("web");
    },
    'android:dev': async () => {
      await buildAll(true);
      await androidDev();
    },
    'android:build': async () => {
      await buildAll(false);
      await buildAndroid(false);
      logger.success("Android build completed 🚀");
    },
    'windows:dev': async () => {
      await buildAll(true);
      await buildWindows(true);
      await runDevServer("web");
      await openWinApp();
    },
    'windows:build': async () => {
      await buildAll(false);
      await buildWindows(false);
      logger.success("Windows build completed 🚀");
    },
    'build': async () => {
      await buildAll(false);
    },
    'serve': async () => {
      await buildAll(false);
      await runProdServer();
    },
    'init': async () => {
      await init().catch((e: Error) => {
        console.error("Initialization failed:", e);
        process.exit(1);
      });
    },
  };
  
  if (command && command in commandHandlers) {
    await commandHandlers[command]();
  } else if (command) {
    logger.error(`Unknown command: ${command}`);
    logger.info("Available commands: dev, android:dev, android:build, windows:dev, windows:build, build, serve, init");
    process.exit(1);
  } else {
    logger.error("No command provided");
    logger.info("Available commands: dev, android:dev, android:build, windows:dev, windows:build, build, serve, init");
    process.exit(1);
  }
}

// Error handling
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled Promise rejection:", err);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main().catch(err => {
    logger.error("An unexpected error occurred:", err);
    process.exit(1);
  });
}

export default { buildAll, loadConfig, defineConfig };