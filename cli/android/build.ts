import path from "path";
import fsSync, { existsSync } from "fs";
import fs from "fs/promises";
import os from "os";
import { spawn, execSync } from "child_process";
import { ensureAndroidInstalled, findAndroidSdk } from "./sdk.js";
import { logger } from "../logger.js";
import { loadConfig } from "../../main.js";
import { Config } from "../../config/index.js";

const PROJECT_ROOT = process.cwd();
const DIST_DIR = path.join(PROJECT_ROOT, "dist");

/* ---------------- Helpers ---------------- */
function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const iface of list || []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}
function patchPermissions(buildDir: string) { 
  const manifestPath = path.join(buildDir, "app", "src", "main", "AndroidManifest.xml");
  if (!existsSync(manifestPath)) return;

  let content = fsSync.readFileSync(manifestPath, "utf8");

  content = content.replace(/<uses-permission android:name="[^"]*" \/>/g, "");

  const basePerms = [
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'
  ];

  fsSync.writeFileSync(manifestPath, content, "utf8");
  logger.success("Android permissions patched");
}
async function ensureLocalProperties(buildDir: string, sdkPath?: string) {
  const localPropsPath = path.join(buildDir, "local.properties");

  if (existsSync(localPropsPath)) return;

  if (!sdkPath) {
    const sdkInfo = findAndroidSdk();
    sdkPath = sdkInfo?.sdkPath;
    if (!sdkPath) throw new Error("Android SDK not found");
  }

  const sdkDir = sdkPath.replace(/\\/g, "\\\\");
  await fs.writeFile(localPropsPath, `sdk.dir=${sdkDir}\n`);
  logger.success(`Created local.properties → ${sdkPath}`);
}

async function copyDir(src: string, dest: string) {
  // Async recursive copy
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  await Promise.all(entries.map(async (entry) => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(srcPath, destPath);
    else await fs.copyFile(srcPath, destPath);
  }));
}

async function removeDir(dir: string) {
  if (existsSync(dir)) await fs.rm(dir, { recursive: true, force: true });
}

/* ---------------- Main Patches ---------------- */
async function patchMainActivity(buildDir: string, APP_ID: string, isDev: boolean) {
  const javaDir = path.join(buildDir, "app", "src", "main", "java");
  const packageDir = path.join(javaDir, APP_ID.split(".").join(path.sep));
  const mainActivityPath = path.join(packageDir, "MainActivity.kt");

  if (!existsSync(mainActivityPath)) throw new Error(`MainActivity.kt not found in ${packageDir}`);

  let content = await fs.readFile(mainActivityPath, "utf8");

  const baseUrl = isDev
    ? `"http://${getLocalIP()}:3000/"`
    : `"file:///android_asset/${APP_ID}/"`;

  content = content.replace(/private\s+var\s+baseUrl\s*=\s*"[^"]*"/, `private var baseUrl = ${baseUrl}`);
  await fs.writeFile(mainActivityPath, content, "utf8");
  logger.success(`MainActivity patched → ${baseUrl} (${isDev ? "DEV" : "PROD"} mode)`);
}

async function copyAssets(buildDir: string, APP_ID: string) {
  const assetsDir = path.join(buildDir, "app", "src", "main", "assets", APP_ID);
  await removeDir(assetsDir);
  await copyDir(DIST_DIR, assetsDir);
  logger.success(`Assets copied → ${assetsDir}`);
}

async function renamePackage(buildDir: string, oldPackage: string, newPackage: string) {
  const javaDir = path.join(buildDir, "app", "src", "main", "java");
  const oldDir = path.join(javaDir, ...oldPackage.split("."));
  const newDir = path.join(javaDir, ...newPackage.split("."));
  await fs.mkdir(path.dirname(newDir), { recursive: true });
  if (existsSync(oldDir)) await copyDir(oldDir, newDir);
}
function patchAppMeta(buildDir: string) {
  // config is loaded internally
}
export async function addDeepLinks(buildDir: string) {
  const config: Config = await loadConfig(PROJECT_ROOT);
  const manifestPath = path.join(buildDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  let manifest = fsSync.readFileSync(manifestPath, 'utf8');

  const deepLinks = config.platforms.android.deepLinks;
  const intentFilters = deepLinks.map(scheme => `
        <intent-filter android:autoVerify="true">
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="${scheme}" />
        </intent-filter>
  `).join('\n');

  manifest = manifest.replace(
    /<activity[^>]*MainActivity[^>]*>/,
    `$&\n${intentFilters}`
  );

  fsSync.writeFileSync(manifestPath, manifest);
}
/* ---------------- Main Build Function ---------------- */
export async function buildAndroid(isDev = false) {
  const config: Config = await loadConfig(PROJECT_ROOT);
  const APP_ID = config.app?.id || "com.vaderjs.app";
  const BUILD_SRC = path.join(PROJECT_ROOT, "node_modules", "vaderjs-native", "templates", "android");
  const BUILD_DIR = path.join(PROJECT_ROOT, "build", "android-src", APP_ID);

  logger.step("Android Build");
  ensureAndroidInstalled();

  // 1️⃣ Clean old build folder
  await removeDir(BUILD_DIR);
  await fs.mkdir(BUILD_DIR, { recursive: true });

  // 2️⃣ Copy template asynchronously
  await copyDir(BUILD_SRC, BUILD_DIR);

  // 3️⃣ Rename package and patch MainActivity
  await renamePackage(BUILD_DIR, "myapp", APP_ID);
  await patchMainActivity(BUILD_DIR, APP_ID, isDev);

  // 4️⃣ Remove old myapp folder
  await removeDir(path.join(BUILD_DIR, "app", "src", "main", "java", "myapp"));

  // 5️⃣ Clean Gradle artifacts
  await removeDir(path.join(BUILD_DIR, "app", "build"));

  // 6️⃣ Local properties, permissions, meta, assets
  await ensureLocalProperties(BUILD_DIR);
  patchPermissions(BUILD_DIR);
  patchAppMeta(BUILD_DIR);
  await copyAssets(BUILD_DIR, APP_ID);
  if (config.platforms?.android?.deepLinks) await addDeepLinks(BUILD_DIR);

  // 7️⃣ Gradle build
  let gradleCmd = process.platform === "win32"
    ? path.join(BUILD_DIR, "gradlew.bat")
    : path.join(BUILD_DIR, "gradlew");
  if (!existsSync(gradleCmd)) gradleCmd = "gradle";

  logger.info("Running Gradle assembleDebug (--no-daemon)...");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(gradleCmd, ["assembleDebug", "--no-daemon"], {
      cwd: BUILD_DIR,
      stdio: "inherit",
      shell: true
    });
    proc.on("exit", code => (code === 0 ? resolve() : reject(new Error(`Gradle failed (${code})`))));
    proc.on("error", reject);
  });

  // 8️⃣ Cleanup lingering Java processes
  try {
    if (process.platform === "win32") execSync("taskkill /F /IM java.exe /T", { stdio: "ignore" });
    else execSync("pkill -f java", { stdio: "ignore" });
  } catch {}

  // 9️⃣ Copy APK to top-level build folder
  const APK_SRC = path.join(BUILD_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  const APK_DEST_DIR = path.join(PROJECT_ROOT, "build");
  await fs.mkdir(APK_DEST_DIR, { recursive: true });
  const APK_DEST = path.join(APK_DEST_DIR, `${APP_ID}-debug.apk`);

  if (!existsSync(APK_SRC)) throw new Error("APK not found after build");
  await fs.copyFile(APK_SRC, APK_DEST);
  logger.success(`APK ready → ${APK_DEST}`);
}
