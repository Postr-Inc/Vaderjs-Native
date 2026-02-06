#!/usr/bin/env bun

import { build, serve } from "bun";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { initProject  } from "./cli";
import { logger, timedStep } from "./cli/logger";
import { colors } from "./cli/logger";
import runDevServer from "vaderjs-native/cli/web/server";
import { runProdServer } from "vaderjs-native/cli/web/server";
import { androidDev } from "./cli/android/dev.js";
import { buildAndroid } from "./cli/android/build";
import { buildWindows } from "./cli/windows/build";
import openWinApp from "./cli/windows/dev";
import { Config } from "./config";

// --- CONSTANTS ---
const PROJECT_ROOT = process.cwd();
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const VADER_SRC_PATH = path.join(PROJECT_ROOT, "node_modules", "vaderjs-native", "index.ts");
const TEMP_SRC_DIR = path.join(PROJECT_ROOT, ".vader_temp_src");

// --- CACHE SYSTEM ---
const buildCache = new Map<string, { mtime: number; hash: string }>();
const configCache = new Map<string, { config: Config; mtime: number }>();
let config: Config = {};
let htmlInjections: string[] = [];

// --- SIMPLIFIED WATCHER ---
class FileWatcher {
  private watchers: Map<string, any>;
  private onChangeCallbacks: Array<(filePath: string) => void>;
  private isRebuilding: boolean;
  private lastRebuildTime: number;
  private readonly REBUILD_COOLDOWN = 1000;

  constructor() {
    this.watchers = new Map();
    this.onChangeCallbacks = [];
    this.isRebuilding = false;
    this.lastRebuildTime = 0;
  }

  shouldIgnorePath(filePath: string): boolean {
    const normalized = path.normalize(filePath);
    // Ignore dist folder and its contents
    if (normalized.includes(path.normalize(DIST_DIR))) {
      return true;
    }
    // Ignore node_modules
    if (normalized.includes(path.normalize('node_modules'))) {
      return true;
    }
    // Ignore .git folder
    if (normalized.includes(path.normalize('.git'))) {
      return true;
    }
    // Ignore the temporary source directory
    if (normalized.includes(path.normalize(TEMP_SRC_DIR))) {
      return true;
    }
    return false;
  }

  async watchDirectory(dirPath: string, recursive = true): Promise<void> {
    // Skip if directory should be ignored
    if (this.shouldIgnorePath(dirPath) || !fsSync.existsSync(dirPath)) {
      return;
    }
    
    try {
      // Close existing watcher if any
      if (this.watchers.has(dirPath)) {
        try {
          this.watchers.get(dirPath).close();
        } catch (err) {
          // Ignore close errors
        }
      }
      
      // Create new watcher
      const watcher = fsSync.watch(dirPath, { recursive }, (eventType: string, filename: string | null) => {
        if (!filename) return;
        
        const changedFile = path.join(dirPath, filename);
        const normalizedChanged = path.normalize(changedFile);
        
        // Skip if file should be ignored
        if (this.shouldIgnorePath(normalizedChanged)) {
          return;
        }
        
        // Check if this is a file we care about
        if (this.shouldTriggerRebuild(normalizedChanged)) {
          logger.info(`File changed: ${path.relative(PROJECT_ROOT, normalizedChanged)}`);
          
          // Only trigger if not already rebuilding and cooldown has passed
          const now = Date.now();
          if (!this.isRebuilding && (now - this.lastRebuildTime) > this.REBUILD_COOLDOWN) {
            this.triggerChange(normalizedChanged);
          } else if (this.isRebuilding) {
            logger.info(`Skipping rebuild - already rebuilding`);
          } else {
            logger.info(`Skipping rebuild - cooldown period`);
          }
        }
      });
      
      watcher.on('error', (err: Error) => {
        logger.warn(`Watcher error on ${dirPath}:`, err.message);
      });
      
      this.watchers.set(dirPath, watcher);
      
      logger.info(`Watching directory: ${path.relative(PROJECT_ROOT, dirPath)}`);
    } catch (err: any) {
      logger.warn(`Could not watch directory ${dirPath}:`, err.message);
    }
  }

  shouldTriggerRebuild(filePath: string): boolean {
    // Only trigger rebuild for specific file types
    const ext = path.extname(filePath).toLowerCase();
    const triggerExtensions = ['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.json', '.config.js', '.config.ts'];
    return triggerExtensions.includes(ext) || ext === '';
  }

  triggerChange(filePath: string): void {
    for (const callback of this.onChangeCallbacks) {
      try {
        callback(filePath);
      } catch (err) {
        logger.error("Change callback error:", err);
      }
    }
  }

  onChange(callback: (filePath: string) => void): () => void {
    this.onChangeCallbacks.push(callback);
    return () => {
      const index = this.onChangeCallbacks.indexOf(callback);
      if (index > -1) this.onChangeCallbacks.splice(index, 1);
    };
  }

  setRebuilding(state: boolean): void {
    this.isRebuilding = state;
    if (state) {
      this.lastRebuildTime = Date.now();
    }
  }

  clear(): void {
    for (const [dir, watcher] of this.watchers) {
      try {
        watcher.close();
      } catch (err) {
        // Ignore close errors
      }
    }
    this.watchers.clear();
    this.onChangeCallbacks = [];
    this.isRebuilding = false;
  }
}

const watcher = new FileWatcher();

// --- CONFIG & PLUGIN SYSTEM ---
interface VaderAPI {
  runCommand: (cmd: string | string[]) => Promise<void>;
  injectHTML: (content: string) => void;
  log: {
    warn: (msg: string) => void;
    info: (msg: string) => void;
    success: (msg: string) => void;
    step: (msg: string) => void;
  };
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
  log: {
    warn: (msg) => logger.warn(msg),
    info: (msg) => logger.info(msg),
    success: (msg) => logger.success(msg),
    step: (msg) => logger.step(msg)
  },
  getProjectRoot: () => PROJECT_ROOT,
  getDistDir: () => DIST_DIR,
  getPublicDir: () => PUBLIC_DIR,
};

// Optimized config loading with cache
export async function loadConfig(projectDir?: string): Promise<Config> {
  projectDir = projectDir || process.cwd();
  const configKey = `config-${projectDir}`;
  
  const configPathJs = path.join(projectDir, "vaderjs.config.js");
  const configPathTs = path.join(projectDir, "vaderjs.config.ts");
  
  let configPath: string | null = null;
  let stat: any = null;
  
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

// Helper to find App.tsx in project root
function findAppFile(): string | null {
  const possiblePaths = [
    path.join(PROJECT_ROOT, "App.tsx"),
    path.join(PROJECT_ROOT, "App.jsx"),
    path.join(PROJECT_ROOT, "App.ts"),
    path.join(PROJECT_ROOT, "App.js")
  ];
  
  for (const appPath of possiblePaths) {
    if (fsSync.existsSync(appPath)) {
      return appPath;
    }
  }
  
  return null;
}

// Helper to find route files in src/pages or src/routes
async function findRouteFiles(): Promise<string[]> {
  const routes: string[] = [];
  
  // Look for pages in src/pages or src/routes
  const possibleDirs = [
    path.join(PROJECT_ROOT, "src", "pages"),
    path.join(PROJECT_ROOT, "src", "routes")
  ];
  
  for (const dir of possibleDirs) {
    if (fsSync.existsSync(dir)) {
      await collectRouteFiles(dir, routes);
    }
  }
  
  return routes;
}

async function collectRouteFiles(dir: string, routes: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      await collectRouteFiles(fullPath, routes);
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) {
      // Check if it's a route component (not layout or other)
      if (!entry.name.includes('.layout.') && !entry.name.includes('.component.')) {
        routes.push(fullPath);
      }
    }
  }
}

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
function absoluteAssetPlugin() {
  return {
    name: "absolute-asset-plugin",
    setup(build) {
      build.onLoad(
        { filter: /\.(js|jsx|ts|tsx)$/ },
        async (args) => {
          let code = await Bun.file(args.path).text();

          // Replace "./asset.ext" → "/asset.ext"
          code = code.replace(
            /(["'`])\.\/([^"'`]+\.(png|jpe?g|svg|webp|gif|avif))\1/g,
            (_, quote, asset) => `${quote}/${asset}${quote}`
          );

          return {
            contents: code,
            loader: args.path.endsWith("x") ? "tsx" : "js",
          };
        }
      );
    },
  };
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
      publicPath: "/",
      env: 'inline',
      minify: false,
        assetNaming: "assets/[name]-[hash].[ext]",
      loader: {
    '.png':  'file', 
    '.svg': 'file',
    '.txt': 'text',
    '.json': 'json'
  },
       
      external: ["vaderjs-native"],
      splitting: false,
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

// --- SINGLE PAGE APPLICATION BUILD ---

const devClientScript = `
<script type="module">
 // connect to ws server
 // reload on changes
 // 
 const ws = new WebSocket('ws://' + location.host + '/__hmr');
 ws.onmessage = (event) => {
   const msg = event.data;
   if (msg === 'reload') {
     console.log('[VaderJS] Reloading due to changes...');
     location.reload();
   }
 };
</script>
`;

async function buildSPAHtml(): Promise<void> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${config.app?.name ?? "Vader App"}</title>
  ${htmlInjections.join("\n")}
</head>
<body>
  <div id="app"></div>
  <script src="/App.js " type="module"></script>
  ${isDev ? devClientScript : ""}
</body>
</html>`;

  await fs.writeFile(path.join(DIST_DIR, "index.html"), html);
}

async function buildRouteComponents(isDev: boolean): Promise<Record<string, string>> {
  const routeFiles = await findRouteFiles();
  const routeMap: Record<string, string> = {};
  
  if (routeFiles.length === 0) {
    logger.info("No route files found in src/pages or src/routes");
    return routeMap;
  }
  
  // Create routes directory
  const routesDir = path.join(DIST_DIR, "routes");
  await fs.mkdir(routesDir, { recursive: true });
  
  // Build each route component separately
  for (const routeFile of routeFiles) {
    // Determine route path from file structure
    const relativePath = path.relative(PROJECT_ROOT, routeFile);
    let routePath = "/";
    
    // Convert file path to route path
    // Example: src/pages/home/index.tsx -> /home
    // Example: src/pages/about.tsx -> /about
    if (relativePath.includes("src/pages/")) {
      routePath = "/" + relativePath
        .replace("src/pages/", "")
        .replace(/\/index\.(tsx|jsx)$/, "")
        .replace(/\.(tsx|jsx)$/, "")
        .replace(/\/$/, "");
    } else if (relativePath.includes("src/routes/")) {
      routePath = "/" + relativePath
        .replace("src/routes/", "")
        .replace(/\/index\.(tsx|jsx)$/, "")
        .replace(/\.(tsx|jsx)$/, "")
        .replace(/\/$/, "");
    }
    
    // Handle root route
    if (routePath === "/index") routePath = "/";
    
    // Generate component name from route
    const componentName = routePath === "/" ? "Home" : 
      routePath.slice(1).split('/').map(part => 
        part.charAt(0).toUpperCase() + part.slice(1)
      ).join('');
    
    // Build the component
    const outputFile = `${componentName}.js`;
    const outputPath = path.join(routesDir, outputFile);
    
    await build({
      entrypoints: [routeFile],
      outdir: routesDir,
      naming: { entry: componentName + ".js" },
      target: "browser",
      minify: !isDev,
      sourcemap: isDev ? "inline" : "external",
      jsxFactory: "Vader.createElement",
      env: 'inline',
      jsxFragment: "Fragment",
      plugins: [publicAssetPlugin()],
      external: ["vaderjs-native"],
    });
    
    routeMap[routePath] = `./routes/${outputFile}`;
  }
  
  return routeMap;
}

 

async function buildAppEntry(isDev: boolean): Promise<void> {
  const appFile = findAppFile();
  
  if (!appFile) {
    logger.error("No App.tsx or App.jsx found in project root!");
    throw new Error("Missing App.tsx/App.jsx in project root");
  }
  
  // Build the App component
  await build({
    entrypoints: [appFile],
    outdir: DIST_DIR,
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "external",
    jsxFactory: "Vader.createElement",
    jsxFragment: "Fragment",
    env: "inline",
    naming: "App.js",
    plugins: [publicAssetPlugin()],
    external: ["./routes.manifest.js"],
  });
}

async function buildMainRuntime(isDev: boolean): Promise<void> {
  
}

async function buildSPA(isDev: boolean): Promise<void> {
  logger.step("Building SPA");
  
  // 1. Generate single HTML file
  await buildSPAHtml();
  
  // 2. Build route components separately
  const routeMap = await buildRouteComponents(isDev);
   
  
  // 4. Build App component
  await buildAppEntry(isDev);
  
  // 5. Build main runtime that ties everything together
  await buildMainRuntime(isDev);
}

async function buildMPA(isDev: boolean): Promise<void> {
  logger.step("Building MPA (Single page with all routes bundled)");
  
  const appFile = findAppFile();
  
  if (!appFile) {
    logger.warn("No App.tsx or App.jsx found for MPA mode.");
    return;
  }
  
  // For MPA, just bundle everything together
  await buildSPAHtml();
  
  // Build single bundle with all routes
  await build({
    entrypoints: [appFile],
    outdir: DIST_DIR,
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "external",
    jsxFactory: "Vader.createElement",
    jsxFragment: "Fragment",
    naming: "index.js",
    plugins: [publicAssetPlugin()],
    external: [],
  });
}

async function buildAppEntrypoints(isDev = false): Promise<void> {
  const appFile = findAppFile();
  
  if (!appFile) {
    logger.warn("No App.tsx or App.jsx found in project root.");
    return;
  }
  
  if (config.build_type === "spa") {
    await buildSPA(isDev);
  } else {
    await buildMPA(isDev);
  }
}

// --- MAIN BUILD FUNCTION ---
export async function buildAll(isDev = false): Promise<void> {
  config = await loadConfig();
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
    { name: "Building App Entrypoints", fn: () => buildAppEntrypoints(isDev) },
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
  
  const command = process.argv[2];
  const arg = process.argv[3];
  
  // Set global flags
  globalThis.isDev = command?.includes('dev') || false;
  globalThis.isBuildingForWindows = command?.includes('windows') || false;
  
  // Commands that don't require config
  if (command === "init") {
    await initProject(arg);
    return;
  }

  // Load config for runtime commands
  config = await loadConfig();
  config.port = config.port || 3000;
  
  // Command router
  const commandHandlers: Record<string, () => Promise<void>> = {
    'add': async () => {
      if (!arg) {
        logger.error("Please specify a plugin to add.");
        process.exit(1);
      }
      await addPlugin(arg);
    },
    'list_plugins': async () => {
      await listPlugins();
    },
    'remove': async () => {
      if (!arg) {
        logger.error("Please specify a plugin to remove.");
        process.exit(1);
      }
      await removePlugin(arg);
    },
    'dev': async () => {
      globalThis.isDev = true;
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
    }
  };
  
  if (command && command in commandHandlers) {
    await commandHandlers[command]();
  } else {
    logger.error(`Unknown command: ${command ?? ""}`);
    logger.info(`
Available commands:
  dev            Start dev server
  build          Build for production
  serve          Build + serve production
  init [dir]     Create a new Vader project
  add <plugin>   Add a Vader plugin
  remove <plugin> Remove a Vader plugin
  list_plugins   List currently installed Vaderjs plugins
  android:dev    Start Android development
  android:build  Build Android app
  windows:dev    Start Windows development
  windows:build  Build Windows app
    `.trim());
    process.exit(1);
  }
}

// Stub functions for plugin management
async function addPlugin(pluginName: string): Promise<void> {
  logger.info(`Adding plugin: ${pluginName}`);
  // TODO: Implement plugin addition
  logger.warn("Plugin addition not yet implemented");
}

async function removePlugin(pluginName: string): Promise<void> {
  logger.info(`Removing plugin: ${pluginName}`);
  // TODO: Implement plugin removal
  logger.warn("Plugin removal not yet implemented");
}

async function listPlugins(): Promise<void> {
  logger.info("Currently installed plugins:");
  if (config.plugins && config.plugins.length > 0) {
    config.plugins.forEach((plugin, index) => {
      logger.info(`  ${index + 1}. ${plugin.name || 'Unnamed plugin'}`);
    });
  } else {
    logger.info("  No plugins installed.");
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