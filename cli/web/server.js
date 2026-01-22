import path from "path";
import fsSync from "fs";
import { serve } from "bun"; 
import { logger } from "../logger.js";
import { buildAll } from "../../main.js";
var PROJECT_ROOT = path.join(process.cwd());
import { colors } from "../logger.js";
function safeWatch(dir, cb) {
  try {
    const watcher = fsSync.watch(dir, { recursive: true }, cb);
    watcher.on("error", (err) => logger.warn(`Watcher error on ${dir}:`, err));
    return watcher;
  } catch (err) {
    logger.warn(`Failed to watch ${dir}:`, err);
  }
}

async function loadConfig() {
  try {
    const configModule = await import(path.join(PROJECT_ROOT, "vaderjs.config.js"));
    return configModule.default || configModule;
  } catch {
    console.log(path.join(PROJECT_ROOT, "vaderjs.config.js"))
    logger.warn("No 'vader.config.js' found, using defaults.");
    return {};
  }
}
var config = await loadConfig();
function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

var APP_DIR = path.join(process.cwd(),    "app");
var SRC_DIR = path.join(process.cwd(),    "src");
var PUBLIC_DIR = path.join(process.cwd(), "public");
var DIST_DIR = path.join(process.cwd(),   "dist");

export default async function runDevServer() {
  await buildAll(true);

  const clients = new Set();
  const port = config.port || 3000;

  logger.info(`Starting dev server at http://localhost:${port}`);

  serve({
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/__hmr" && server.upgrade(req)) {
        return;
      }
      let filePath = path.join(DIST_DIR, url.pathname);
      if (!path.extname(filePath)) {
        filePath = path.join(filePath, "index.html");
      }
      const file = Bun.file(filePath);
      return file.exists().then(exists =>
        exists ? new Response(file) : new Response("Not Found", { status: 404 })
      );
    },
    websocket: {
      open: (ws) => clients.add(ws),
      close: (ws) => clients.delete(ws),
    },
  });

  const debouncedBuild = debounce(async () => {
    try {
      await buildAll(true);
      for (const client of clients) {
        client.send("reload");
      }
    } catch (e) {
      logger.error("Rebuild failed:", e);
    }
  }, 200);

  const watchDirs = [APP_DIR, SRC_DIR, PUBLIC_DIR].filter(fsSync.existsSync);
  for (const dir of watchDirs) {
    safeWatch(dir, debouncedBuild);
  }
}

export async function runProdServer() {
  const port = config.port || 3000;
  logger.info(`Serving production build from /dist on http://localhost:${port}`);

  serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      let filePath = path.join(DIST_DIR, url.pathname);
      if (!path.extname(filePath)) {
        filePath = path.join(filePath, "index.html");
      }
      const file = Bun.file(filePath);
      return file.exists().then(exists =>
        exists ? new Response(file) : new Response("Not Found", { status: 404 })
      );
    },
  });
}