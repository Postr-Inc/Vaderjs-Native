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

  content = content.replace(/<uses-permission android:name="[^"]*" \/>/g, "");

  const basePerms = [
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'
  ];
  
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

  if (!sdkPath) {
    const sdkInfo = findAndroidSdk(); 
    sdkPath = sdkInfo?.sdkPath;
    if (!sdkPath) throw new Error("Android SDK not found");
  }

  await fs.writeFile(
    localPropsPath,
    `sdk.dir=${sdkPath.replace(/\\/g, "\\\\")}\n`
  ); 

  logger.success(`✅ Created local.properties → ${sdkPath}`);
}

async function copyDir(src: string, dest: string) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  await Promise.all(entries.map(async (entry) => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      if (entry.name.endsWith('.kt')) {
        const content = await fs.readFile(srcPath, "utf8");
        await fs.writeFile(destPath, content, "utf8");
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }));
}

async function removeDir(dir: string) {
  if (existsSync(dir)) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error: any) {
      if (error.code === 'EBUSY') {
        logger.warn(`⚠️ Directory ${dir} is busy, retrying...`);
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

  content = content.replace(/package \{\{APP_PACKAGE\}\}/g, `package ${APP_ID}`);

  const baseUrl = isDev
    ? `"http://${getLocalIP()}:${config.port || 3000}/"`
    : `"file:///android_asset/${APP_ID}/"`;

  content = content.replace(/private\s+val\s+baseUrl\s*=\s*"[^"]*"/, `private val baseUrl = ${baseUrl}`);
  content = content.replace(/\{\{BASE_URL\}\}/g, baseUrl);
  await fs.writeFile(mainActivityPath, content, "utf8");
  logger.success(`✅ MainActivity patched → ${baseUrl} (${isDev ? "DEV" : "PROD"} mode)`);
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
  
  if (config.app?.name) {
    content = content.replace(/android:label="[^"]*"/, `android:label="${config.app.name}"`);
  }
  
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
  const BUILD_SRC = await fetchBinary("android", pkg.binaryVersion);
  const BUILD_DIR = path.join(process.cwd(), "build", "android-src", APP_ID);

  logger.step("🚀 Android Build");
  ensureAndroidInstalled();

  // 1️⃣ Clean old build folder
  try {
    await removeDir(BUILD_DIR);
  } catch (error) {
    logger.warn(`⚠️ Could not clean build directory, continuing...`);
  }

  // 2️⃣ Copy template
  await copyDir(BUILD_SRC, BUILD_DIR);

  // 3️⃣ Rename package and patch files
  await renamePackage(BUILD_DIR, "myapp", APP_ID);
  
  await ensureLocalProperties(BUILD_DIR);
  
  // Patch AndroidBridge.kt directly
const bridgePath = path.join(BUILD_DIR, "app", "src", "main", "java", ...APP_ID.split("."), "AndroidBridge.kt");
if (existsSync(bridgePath)) {
    let bridgeContent = await fs.readFile(bridgePath, "utf8");
    
    // Remove any existing package declaration
    bridgeContent = bridgeContent.replace(/^package\s+[^\n]+\n/, '');
    
    // Add correct package declaration at the beginning
    bridgeContent = `package ${APP_ID}\n\n${bridgeContent}`;
    
    await fs.writeFile(bridgePath, bridgeContent, "utf8");
    logger.success("✅ AndroidBridge patched with package name");
}
   
  await patchMainActivity(BUILD_DIR, APP_ID, isDev, config);
  await patchGradleFiles(BUILD_DIR, APP_ID);

  // 4️⃣ Remove old myapp folder
  await removeDir(path.join(BUILD_DIR, "app", "src", "main", "java", "myapp"));

  // 5️⃣ Clean Gradle artifacts
  await removeDir(path.join(BUILD_DIR, "app", "build"));

  // 6️⃣ Apply patches and copy assets
  patchPermissions(BUILD_DIR);
  patchAppMeta(BUILD_DIR, config);
  await copyAssets(BUILD_DIR, APP_ID);
  
  if (config.platforms?.android?.deepLinks) {
    await addDeepLinks(BUILD_DIR);
  }

  // 7️⃣ Gradle build - FIXED: Use Bun.spawn instead of Node's spawn
  let gradleCmd = process.platform === "win32"
    ? path.join(BUILD_DIR, "gradlew.bat")
    : path.join(BUILD_DIR, "gradlew");
  
  // Check if gradlew exists
  if (!existsSync(gradleCmd)) {
    logger.error(`❌ Gradle wrapper not found at: ${gradleCmd}`);
    logger.info("⚠️ Trying to use system gradle...");
    gradleCmd = "gradle";
  } else {
    logger.info(`✅ Found gradlew at: ${gradleCmd}`);
  }

  logger.info("⚙️ Running Gradle assembleDebug...");
  
  // Use Bun.spawn which handles paths better
  try {
    const proc = Bun.spawn([gradleCmd, "assembleDebug", "--no-daemon"], {
      cwd: BUILD_DIR,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit"
    });

    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      throw new Error(`❌ Gradle failed with exit code ${exitCode}`);
    }
    
    logger.success("✅ Gradle build completed successfully");
  } catch (error: any) {
    logger.error(`❌ Failed to run Gradle: ${error.message}`);
    
    // Fallback: try using cmd /c for Windows
    if (process.platform === "win32") {
      logger.info("🔄 Trying fallback method with cmd /c...");
      try {
        const cmd = `cd /d "${BUILD_DIR}" && "${gradleCmd}" assembleDebug --no-daemon`;
        logger.info(`📝 Running: ${cmd}`);
        
        const proc = Bun.spawn(["cmd", "/c", cmd], {
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit"
        });

        const exitCode = await proc.exited;
        
        if (exitCode !== 0) {
          throw new Error(`❌ Fallback also failed with exit code ${exitCode}`);
        }
        
        logger.success("✅ Gradle build completed with fallback method");
      } catch (fallbackError: any) {
        throw new Error(`❌ All Gradle build attempts failed: ${fallbackError.message}`);
      }
    } else {
      throw error;
    }
  }

  // 8️⃣ Cleanup Java processes if needed
  try {
    if (process.platform === "win32") {
      execSync("taskkill /F /IM java.exe /T 2>nul", { stdio: "ignore" });
    } else {
      execSync("pkill -f java 2>/dev/null", { stdio: "ignore" });
    }
  } catch {}

  // 9️⃣ Copy APK to top-level build folder
  const APK_SRC = path.join(BUILD_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  const APK_DEST_DIR = path.join(PROJECT_ROOT, "build");
  
  if (!existsSync(APK_DEST_DIR)) {
    await fs.mkdir(APK_DEST_DIR, { recursive: true });
  }
  
  const APK_DEST = path.join(APK_DEST_DIR, `${APP_ID}-debug.apk`);

  if (!existsSync(APK_SRC)) {
    // Try alternative APK location
    const altApkPath = path.join(BUILD_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
    if (existsSync(altApkPath)) {
      await fs.copyFile(altApkPath, APK_DEST);
      logger.success(`✅ APK ready → ${APK_DEST}`);
      return APK_DEST;
    }
    throw new Error(`❌ APK not found after build. Checked: ${APK_SRC}`);
  }
  
  await fs.copyFile(APK_SRC, APK_DEST);
  logger.success(`✅ APK ready → ${APK_DEST}`);
  
  return APK_DEST;
}