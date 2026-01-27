import path from "path";
import fsSync, { existsSync } from "fs";
//@ts-ignore
import pkg from "../../package.json" assert { type: "json" };
import fs from "fs/promises";
import os from "os";
import { spawn, execSync } from "child_process";
import { ensureAndroidInstalled, findAndroidSdk } from "./sdk.js";
import { logger } from "../logger.js";
import { loadConfig } from "../../main.js";
import { Config } from "../../config/index.js";
import { fetchBinary } from "../binaries/fetch.js";
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

  // Remove existing permissions
  content = content.replace(/<uses-permission android:name="[^"]*" \/>/g, "");

  // Add basic permissions
  const basePerms = [
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'
  ];
  
  // Insert permissions before application tag
  const applicationIndex = content.indexOf("<application");
  if (applicationIndex !== -1) {
    const beforeApplication = content.substring(0, applicationIndex);
    const afterApplication = content.substring(applicationIndex);
    content = beforeApplication + basePerms.join("\n") + "\n" + afterApplication;
  }

  fsSync.writeFileSync(manifestPath, content, "utf8");
  logger.success("✅ Android permissions patched");
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
  logger.success(`✅ Created local.properties → ${sdkPath}`);
}

async function copyDir(src: string, dest: string) {
  // Async recursive copy with explicit encoding handling
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  await Promise.all(entries.map(async (entry) => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      // For .kt files, read and write to ensure encoding is preserved
      if (entry.name.endsWith('.kt')) {
        const content = await fs.readFile(srcPath, "utf8");
        await fs.writeFile(destPath, content, "utf8");
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }));
}

async function patchAllKotlinFiles(javaDir: string, APP_ID: string) {
  async function patchDir(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await patchDir(fullPath);
      } else if (entry.name.endsWith('.kt')) {
        let content = await fs.readFile(fullPath, "utf8");
        content = content.replace(/package \{\{APP_PACKAGE\}\}/g, `package ${APP_ID}`);
        await fs.writeFile(fullPath, content, "utf8");
      }
    }));
  }
  
  await patchDir(javaDir);
  logger.success("✅ All Kotlin files patched with package name");
}

async function removeDir(dir: string) {
  if (existsSync(dir)) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error: any) {
      if (error.code === 'EBUSY') {
        logger.warn(`⚠️ Directory ${dir} is busy, retrying...`);
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          await fs.rm(dir, { recursive: true, force: true });
        } catch (retryError) {
          logger.error(`❌ Failed to remove ${dir} after retry`);
          throw retryError;
        }
      } else {
        throw error;
      }
    }
  }
}

/* ---------------- Main Patches ---------------- */
async function patchMainActivity(buildDir: string, APP_ID: string, isDev: boolean, config: Config) {
  const javaDir = path.join(buildDir, "app", "src", "main", "java");
  const packageDir = path.join(javaDir, ...APP_ID.split("."));
  const mainActivityPath = path.join(packageDir, "MainActivity.kt");

  if (!existsSync(mainActivityPath)) throw new Error(`MainActivity.kt not found in ${packageDir}`);

  let content = await fs.readFile(mainActivityPath, "utf8");

  // Replace package declaration
  content = content.replace(/package \{\{APP_PACKAGE\}\}/g, `package ${APP_ID}`);

  const baseUrl = isDev
    ? `"http://${getLocalIP()}:${config.port || 3000}/"`
    : `"file:///android_asset/${APP_ID}/"`;

  content = content.replace(/private\s+val\s+baseUrl\s*=\s*"[^"]*"/, `private val baseUrl = ${baseUrl}`);
  content = content.replace(/\{\{BASE_URL\}\}/g, baseUrl);
  await fs.writeFile(mainActivityPath, content, "utf8");
  logger.success(`✅ MainActivity patched → ${baseUrl} (${isDev ? "DEV" : "PROD"} mode)`);
}

async function patchAndroidBridge(buildDir: string, APP_ID: string) {
  const javaDir = path.join(buildDir, "app", "src", "main", "java");
  const packageDir = path.join(javaDir, ...APP_ID.split("."));
  const bridgePath = path.join(packageDir, "AndroidBridge.kt");

  if (!existsSync(bridgePath)) return;

  let content = await fs.readFile(bridgePath, "utf8");
  content = content.replace(/package \{\{APP_PACKAGE\}\}/g, `package ${APP_ID}`);
  await fs.writeFile(bridgePath, content, "utf8");
  logger.success("✅ AndroidBridge patched");
}

async function copyAssets(buildDir: string, APP_ID: string) {
  const assetsDir = path.join(buildDir, "app", "src", "main", "assets", APP_ID);
  await removeDir(assetsDir);
  
  if (!existsSync(DIST_DIR)) {
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(path.join(assetsDir, "index.html"), "<h1>No build output found</h1>");
    logger.warn("⚠️ Dist folder empty, created placeholder index.html");
    return;
  }
  
  await copyDir(DIST_DIR, assetsDir);
  logger.success(`✅ Assets copied → ${assetsDir}`);
}

async function renamePackage(buildDir: string, oldPackage: string, newPackage: string) {
  const javaDir = path.join(buildDir, "app", "src", "main", "java");
  const oldDir = path.join(javaDir, ...oldPackage.split("."));
  const newDir = path.join(javaDir, ...newPackage.split("."));
  
  if (!existsSync(oldDir)) {
    logger.warn(`⚠️ Source directory not found: ${oldDir}`);
    return;
  }
  
  // Create parent directory first
  await fs.mkdir(path.dirname(newDir), { recursive: true });
  
  if (existsSync(newDir)) {
    await removeDir(newDir);
  }
  
  await copyDir(oldDir, newDir);
  logger.success(`✅ Renamed package: ${oldPackage} → ${newPackage}`);
}

async function patchGradleFiles(buildDir: string, APP_ID: string) {
  const buildGradlePath = path.join(buildDir, "app", "build.gradle.kts");
  if (!existsSync(buildGradlePath)) return;
  
  let content = fsSync.readFileSync(buildGradlePath, "utf8");
  content = content.replace(/\{\{APP_PACKAGE\}\}/g, APP_ID);
  fsSync.writeFileSync(buildGradlePath, content, "utf8");
  logger.success("✅ Gradle files patched with package name");
}

function patchAppMeta(buildDir: string, config: Config) {
  const manifestPath = path.join(buildDir, "app", "src", "main", "AndroidManifest.xml");
  if (!existsSync(manifestPath)) return;

  let content = fsSync.readFileSync(manifestPath, "utf8");
  
  // Update app name and label if provided
  if (config.app?.name) {
    content = content.replace(/android:label="[^"]*"/, `android:label="${config.app.name}"`);
  }
  
  // Update version info if provided
  if (config.app?.version) {
    content = content.replace(/android:versionCode="[^"]*"/, `android:versionCode="${config.app.version.code}"`);
    content = content.replace(/android:versionName="[^"]*"/, `android:versionName="${config.app.version.name}"`);
  }

  fsSync.writeFileSync(manifestPath, content, "utf8");
  logger.success("✅ App metadata patched");
}

export async function addDeepLinks(buildDir: string) {
  const config: Config = await loadConfig(PROJECT_ROOT);
  
  if (!config.platforms?.android?.deepLinks || config.platforms.android.deepLinks.length === 0) {
    return;
  }
  
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
  logger.success(`✅ Added ${deepLinks.length} deep link(s)`);
}

/* ---------------- Main Build Function ---------------- */
export async function buildAndroid(isDev = false) {
  const config: Config = await loadConfig(process.cwd());
  const APP_ID = config.app?.id || "com.vaderjs.app";
  const BUILD_SRC = await fetchBinary("android", pkg.version);
  const BUILD_DIR = path.join(process.cwd(), "build", "android-src", APP_ID);

  logger.step("🚀 Android Build");
  ensureAndroidInstalled();

  // FIX: Remove the duplicate mkdir call
// 1️⃣ Clean old build folder with retry
  try {
    await removeDir(BUILD_DIR);
  } catch (error) {
    logger.warn(`⚠️ Could not clean build directory, continuing...`);
  }
  // DON'T call mkdir here - it will be created by copyDir later

  // 2️⃣ Copy template asynchronously
  await copyDir(BUILD_SRC, BUILD_DIR);

// 3️⃣ Rename package and patch MainActivity
  await renamePackage(BUILD_DIR, "myapp", APP_ID);
  
  // Patch AndroidBridge.kt directly
  const bridgePath = path.join(BUILD_DIR, "app", "src", "main", "java", ...APP_ID.split("."), "AndroidBridge.kt");
  if (existsSync(bridgePath)) {
    let bridgeContent = await fs.readFile(bridgePath, "utf8");
    bridgeContent = `package ${APP_ID} 
    ${bridgeContent}`;
    await fs.writeFile(bridgePath, bridgeContent, "utf8");
  }
  
  await patchMainActivity(BUILD_DIR, APP_ID, isDev, config);
  await patchGradleFiles(BUILD_DIR, APP_ID);

  // 4️⃣ Remove old myapp folder
  await removeDir(path.join(BUILD_DIR, "app", "src", "main", "java", "myapp"));

  // 5️⃣ Clean Gradle artifacts
  await removeDir(path.join(BUILD_DIR, "app", "build"));

// 6️⃣ Local properties, permissions, meta, assets
  await ensureLocalProperties(BUILD_DIR);
  patchPermissions(BUILD_DIR);
  patchAppMeta(BUILD_DIR, config);
  await copyAssets(BUILD_DIR, APP_ID);
  
  if (config.platforms?.android?.deepLinks) {
    await addDeepLinks(BUILD_DIR);
  }

  // 7️⃣ Gradle build
  let gradleCmd = process.platform === "win32"
    ? path.join(BUILD_DIR, "gradlew.bat")
    : path.join(BUILD_DIR, "gradlew");
  
  if (!existsSync(gradleCmd)) gradleCmd = "gradle";

  logger.info("⚙️ Running Gradle assembleDebug (--no-daemon)...");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(gradleCmd, ["assembleDebug", "--no-daemon"], {
      cwd: BUILD_DIR,
      stdio: "inherit",
      shell: true
    });
    proc.on("exit", code => (code === 0 ? resolve() : reject(new Error(`❌ Gradle failed (${code})`))));
    proc.on("error", reject);
  });

  // 8️⃣ Cleanup lingering Java processes
  try {
    if (process.platform === "win32") {
      execSync("taskkill /F /IM java.exe /T", { stdio: "ignore" });
    } else {
      execSync("pkill -f java", { stdio: "ignore" });
    }
  } catch {}

  // 9️⃣ Copy APK to top-level build folder
  const APK_SRC = path.join(BUILD_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  const APK_DEST_DIR = path.join(PROJECT_ROOT, "build");
  
  // FIX: Use existsSync check before mkdir
  if (!existsSync(APK_DEST_DIR)) {
    await fs.mkdir(APK_DEST_DIR, { recursive: true });
  }
  
  const APK_DEST = path.join(APK_DEST_DIR, `${APP_ID}-debug.apk`);

  if (!existsSync(APK_SRC)) {
    throw new Error(`❌ APK not found after build at: ${APK_SRC}`);
  }
  
  await fs.copyFile(APK_SRC, APK_DEST);
  logger.success(`✅ APK ready → ${APK_DEST}`);
  
  return APK_DEST;
}