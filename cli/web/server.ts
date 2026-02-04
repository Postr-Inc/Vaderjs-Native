import path from "path";
import fsSync from "fs";
import { serve, FileSystemRouter, glob } from "bun";
import { logger } from "vaderjs-native/cli/logger.js";
import { buildAll } from "vaderjs-native/main.js";

const PROJECT_ROOT = path.join(process.cwd());
const DIST_DIR = path.join(PROJECT_ROOT, "dist");

// Helper to check if a path should be ignored
function shouldIgnorePath(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  
  // Ignore common system and build directories
  const ignorePatterns = [
    path.normalize('node_modules'),
    path.normalize('dist'),
    path.normalize('.git'),
    path.normalize('.vscode'),
    path.normalize('.idea'),
    path.normalize('build'),
    path.normalize('.next'),
    path.normalize('.nuxt'),
    path.normalize('.cache'),
    path.normalize('temp'),
    path.normalize('tmp'),
    path.normalize('coverage'),
    path.normalize('.npm'),
    path.normalize('yarn.lock'),
    path.normalize('package-lock.json'),
    path.normalize('.env'),
  ];
  
  // Also ignore common temporary and system files
  const ignoreFilePatterns = [
    /\.log$/,
    /\.tmp$/,
    /\.temp$/,
    /\.swp$/,
    /~$/,
    /\.DS_Store$/,
    /Thumbs\.db$/,
    /desktop\.ini$/,
  ];
  
  // Check if path contains any ignore patterns
  for (const pattern of ignorePatterns) {
    if (normalized.includes(pattern)) {
      return true;
    }
  }
  
  // Check if filename matches ignore patterns
  const filename = path.basename(normalized);
  for (const pattern of ignoreFilePatterns) {
    if (pattern.test(filename)) {
      return true;
    }
  }
  
  return false;
}

// Track watchers for cleanup
const watchers = new Map<string, any>();

function safeWatch(dir: string, cb: (event: string, filename: string | null) => void) {
  // Don't watch system directories or paths outside project
  if (shouldIgnorePath(dir) || !dir.startsWith(PROJECT_ROOT)) {
    logger.debug(`Skipping watch on directory: ${dir}`);
    return null;
  }
  
  // Check if directory exists
  if (!fsSync.existsSync(dir)) {
    logger.warn(`Directory does not exist: ${dir}`);
    return null;
  }
  
  try {
    // Close existing watcher if any
    if (watchers.has(dir)) {
      try {
        watchers.get(dir).close();
      } catch (err) {
        // Ignore close errors
      }
    }
    
    const watcher = fsSync.watch(dir, { recursive: true }, (event: string, filename: string | null) => {
      if (!filename) return;
      
      const changedFile = path.join(dir, filename);
      
      // Skip ignored files
      if (shouldIgnorePath(changedFile)) {
        return;
      }
      
      // Only process files we care about
      const ext = path.extname(changedFile).toLowerCase();
      const relevantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.json', '.config.js', '.config.ts'];
      
      if (relevantExtensions.includes(ext) || ext === '') {
        logger.info(`📁 File changed: ${path.relative(PROJECT_ROOT, changedFile)}`);
        cb(event, filename);
      }
    });
    
    watcher.on("error", (err: Error) => logger.warn(`Watcher error on ${dir}:`, err.message));
    watchers.set(dir, watcher);
    
    logger.info(`👀 Watching directory: ${path.relative(PROJECT_ROOT, dir)}`);
    return watcher;
  } catch (err: any) {
    logger.warn(`Failed to watch ${dir}:`, err.message);
    return null;
  }
}

async function loadConfig() {
  try {
    const configModule = await import(path.join(PROJECT_ROOT, "vaderjs.config.js"));
    return configModule.default || configModule;
  } catch {
    logger.warn("No 'vaderjs.config.js' found, using defaults.");
    return {};
  }
}

function debounce(fn: Function, delay: number) {
  let timeoutId: Timer;
  return (...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// Find all relevant source directories in the project
function findSourceDirectories(): string[] {
  const dirs = new Set<string>();
  
  // Always include project root
  dirs.add(PROJECT_ROOT);
  
  // Add common source directories if they exist
  const commonDirs = ['src', 'app', 'pages', 'components', 'public', 'styles'];
  for (const dir of commonDirs) {
    const fullPath = path.join(PROJECT_ROOT, dir);
    if (fsSync.existsSync(fullPath) && fsSync.statSync(fullPath).isDirectory()) {
      dirs.add(fullPath);
    }
  }
  
  return Array.from(dirs);
}

async function handleRequestSimple(req: Request) {
  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname); 
  
  // Add trailing slash for directories without extensions
  if (!pathname.endsWith('/') && !path.extname(pathname)) {
    return Response.redirect(`${pathname}/`, 308);
  }
  
  // 1️⃣ STATIC FILES (with extension)
  if (path.extname(pathname)) {
    // Try exact path first: /styles.css → /dist/styles.css
    let staticPath = path.join(DIST_DIR, pathname.slice(1));
    let file = Bun.file(staticPath);

    if (await file.exists()) {
      return new Response(file, {
        headers: { "Content-Type": getContentType(path.extname(staticPath)) }
      });
    }

    // Try route-relative: /login/foo.png → /dist/login/foo.png
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 1) {
      staticPath = path.join(
        DIST_DIR,
        segments[0],           // login
        segments.slice(1).join('/')
      );

      file = Bun.file(staticPath);
      if (await file.exists()) {
        return new Response(file, {
          headers: { "Content-Type": getContentType(path.extname(staticPath)) }
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  }

  // 2️⃣ ROUTE HTML: /login → /dist/login/index.html
  const routeHtml = path.join(
    DIST_DIR,
    pathname === '/' ? '' : pathname.slice(1),
    'index.html'
  );

  if (await Bun.file(routeHtml).exists()) {
    return new Response(Bun.file(routeHtml), {
      headers: { "Content-Type": "text/html" }
    });
  }

  // 3️⃣ SPA FALLBACK
  const rootHtml = path.join(DIST_DIR, 'index.html');
  return new Response(Bun.file(rootHtml), {
    headers: { "Content-Type": "text/html" }
  });
}

// Helper function to get content type from file extension
function getContentType(ext: string): string {
  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.cjs': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'font/otf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed'
  };

  return contentTypes[ext] || 'application/octet-stream';
}

// Clean up all watchers
function cleanupWatchers() {
  for (const [dir, watcher] of watchers) {
    try {
      watcher.close();
    } catch (err) {
      // Ignore
    }
  }
  watchers.clear();
}

// DEV SERVER
export default async function runDevServer() {
  const config = await loadConfig();

  // Initial build
  console.log('🔨 Building project...');
  await buildAll(true);

  // Debug build output
  console.log('\n📦 Build output:');
  if (fsSync.existsSync(DIST_DIR)) {
    const items = fsSync.readdirSync(DIST_DIR);
    console.log(`Dist root contains: ${items.join(', ')}`);
  }

  const clients = new Set<WebSocket>();
  const port = config.port || 3000;

  logger.info(`🚀 Starting dev server at http://localhost:${port}`);
  logger.info(`📁 Project root: ${PROJECT_ROOT}`);
  logger.info(`📦 Dist directory: ${DIST_DIR}`);
  logger.info(`🌐 Build type: ${config.build_type || 'spa'}`);

  const server = serve({
    port,
    fetch: async (req) => {
      // handle /__hmr
      const url = new URL(req.url);
      if (url.pathname === '/__hmr') {
          server.upgrade(req);
          return new Response(null, { status: 101 });
      }
      return handleRequestSimple(req);
    },
    websocket: {
      open: (ws) => {
        clients.add(ws);
        console.log(`🔌 WebSocket connected. Total clients: ${clients.size}`);
      },
      close: (ws) => {
        clients.delete(ws);
        console.log(`🔌 WebSocket disconnected. Total clients: ${clients.size}`);
      },
      message: (ws, message) => {
        console.log(`📨 WebSocket message: ${message}`);
      }
    },
  });

  const debouncedBuild = debounce(async () => {
    try {
      console.log('\n🔄 Changes detected, rebuilding...');
      await buildAll(true);

      // Notify all connected WebSocket clients to reload
      console.log(`📢 Notifying ${clients.size} clients to reload`);
      for (const client of clients) {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send("reload");
        }
      }
      logger.info("✅ Rebuilt and reloaded");
    } catch (e) {
      logger.error("❌ Rebuild failed:", e);
    }
  }, 500); // Increased debounce time to 500ms

  // Find and watch source directories
  const watchDirs = findSourceDirectories();
  console.log(`👀 Watching directories: ${watchDirs.map(d => path.relative(PROJECT_ROOT, d)).join(', ')}`);

  for (const dir of watchDirs) {
    safeWatch(dir, debouncedBuild);
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    cleanupWatchers();
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down...');
    cleanupWatchers();
    server.stop();
    process.exit(0);
  });

  // Also handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    cleanupWatchers();
    server.stop();
    process.exit(1);
  });
}

// PROD SERVER
export async function runProdServer() {
  const config = await loadConfig();
  const port = config.port || 3000;

  logger.info(`🚀 Serving production build from /dist on http://localhost:${port}`);

  serve({
    port,
    fetch: async (req) => {
      return handleRequestSimple(req);
    }
  });
}