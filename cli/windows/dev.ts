import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { Glob } from "bun";
import { loadConfig } from "../../main"; 

const PROJECT_ROOT = process.cwd();
const BUILD_DIR = path.join(PROJECT_ROOT, "build", "windows-src");

export default async function openWinApp(isDebug = true) {
  const config = await loadConfig();
  const appFolderName = "App1"; 
  const binDir = path.join(BUILD_DIR, appFolderName, appFolderName, "bin"); 

  const pattern = isDebug
    ? `**/Debug/**/win-*/${config.app.name}.exe`
    : `**/Release/**/win-*/${config.app.name}.exe`;

  const glob = new Glob(pattern, { cwd: binDir, absolute: true, onlyFiles: true });
  const matches: string[] = [];
  for await (const file of glob.scan(".")) { matches.push(file); }

  if (!matches.length) return console.error("❌ No executable found");

  const exePath = matches.sort().reverse()[0];
  const exeDir = path.dirname(exePath);
  const logPath = path.join(exeDir, "app.log");

  // --- LOG WATCHER LOGIC ---
  // We clear the log or ensure it exists before starting
  if (fs.existsSync(logPath)) fs.writeFileSync(logPath, ""); 

  console.log(`🚀 Launching ${config.app.name}`);
  const proc = spawn(exePath, [], { stdio: "inherit", detached: false });

  let lastSize = 0;
  const watchLogs = setInterval(() => {
    try {
      if (!fs.existsSync(logPath)) return;
      
      const stats = fs.statSync(logPath);
      if (stats.size > lastSize) {
        // Open with 'r' flag and read only the new chunk
        const stream = fs.createReadStream(logPath, { start: lastSize, end: stats.size });
        stream.on("data", (chunk) => {
          process.stdout.write(`\x1b[32m[APP-LOG]\x1b[0m ${chunk.toString()}`);
        });
        lastSize = stats.size;
      }
    } catch (e) {
      // Ignore "file in use" errors from Windows
    }
  }, 100); // Check every 100ms

  proc.on("exit", (code) => {
    clearInterval(watchLogs);
    console.log(`\n=== App exited (${code}) ===`);
  });
}