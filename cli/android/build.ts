/* -----------------------------------------------------
   Android Build Script (Fixed)
----------------------------------------------------- */
import path from "path";
import fsSync, { existsSync, rmSync, mkdirSync, cpSync, copyFileSync } from "fs";
import fs from "fs/promises";
import os from "os";
import { spawn, execSync } from "child_process";
import { ensureAndroidInstalled, findAndroidSdk } from "./sdk.js";
import { logger } from "../logger.js";
import { loadConfig } from "../../main.js";
import { Config } from "../../config/index.js";

const PROJECT_ROOT = process.cwd();
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const config: Config = await loadConfig(process.cwd());
/* -----------------------------------------------------
   Helpers
----------------------------------------------------- */
function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const iface of list || []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

 function fixKotlinTemplate(buildDir: string) {
  const javaSrc = path.join(buildDir, "app", "src", "main", "java");
  
  // Find MainActivity.kt
  function findMainActivity(dir) {
    const items = fsSync.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fsSync.statSync(fullPath).isDirectory()) {
        const found = findMainActivity(fullPath);
        if (found) return found;
      } else if (item === "MainActivity.kt") {
        return fullPath;
      }
    }
    return null;
  }
  
  const mainActivityPath = findMainActivity(javaSrc);
  if (!mainActivityPath) {
    console.log("MainActivity.kt not found, skipping template fix");
    return;
  }
  
  console.log(`Fixing Kotlin template at: ${mainActivityPath}`);
  
  // Read the file
  let content = fsSync.readFileSync(mainActivityPath, "utf8");
  
  console.log("Looking for AndroidBridge constructor issue...");
  
  // Fix the AndroidBridge constructor - look for "private val baseUrl" without type
  // Pattern: class AndroidBridge(... private val baseUrl) {
  const bridgePattern = /class\s+AndroidBridge\s*\(([^)]+)\)\s*\{/;
  const bridgeMatch = content.match(bridgePattern);
  
  if (bridgeMatch) {
    console.log("Found AndroidBridge class");
    const params = bridgeMatch[1];
    
    // Check each parameter for missing types
    const paramList = params.split(',').map(p => p.trim());
    const fixedParams = paramList.map(param => {
      if (param.startsWith('private val ') || param.startsWith('private var ')) {
        const parts = param.split(' ');
        if (parts.length === 3 && !param.includes(':')) {
          // Parameter like "private val baseUrl" without type
          const paramName = parts[2];
          // Determine type based on parameter name
          let type = "String";
          if (paramName === "context") type = "Context";
          if (paramName === "webView") type = "WebView";
          if (paramName === "baseUrl") type = "String";
          
          console.log(`Adding type to parameter: ${paramName}: ${type}`);
          return `${parts[0]} ${parts[1]} ${paramName}: ${type}`;
        }
      }
      return param;
    });
    
    if (fixedParams.join(', ') !== params) {
      content = content.replace(
        bridgePattern,
        `class AndroidBridge(${fixedParams.join(', ')}) {`
      );
      console.log("✓ Fixed AndroidBridge constructor parameters");
    }
  }
  
  // Also check for the specific error pattern
  if (content.includes('private val baseUrl)') && !content.includes('private val baseUrl:')) {
    content = content.replace(
      'private val baseUrl)',
      'private val baseUrl: String)'
    );
    console.log("✓ Fixed baseUrl parameter type");
  }
  
  // Fix any other missing parameter types
  const missingTypePattern = /(private\s+(?:val|var)\s+\w+)(?=\s*[,\)])/g;
  let match;
  while ((match = missingTypePattern.exec(content)) !== null) {
    const param = match[1];
    const paramName = param.split(' ').pop();
    let type = "String";
    if (paramName === "context") type = "Context";
    if (paramName === "webView") type = "WebView";
    
    content = content.replace(
      param,
      `${param}: ${type}`
    );
    console.log(`Added type to parameter: ${paramName}: ${type}`);
  }
  
  // Write the fixed file
  fsSync.writeFileSync(mainActivityPath, content, 'utf8');
  console.log('✓ Fixed Kotlin template compilation issues');
}

function getSdkPath(): string {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (() => {
    const home = os.homedir();
    if (process.platform === "win32") return path.join(home, "AppData", "Local", "Android", "Sdk");
    if (process.platform === "darwin") return path.join(home, "Library", "Android", "sdk");
    return path.join(home, "Android", "Sdk");
  })();
}

/* -----------------------------------------------------
   Ensure local.properties
----------------------------------------------------- */
async function ensureLocalProperties(buildDir: string) {
  const localPropsPath = path.join(buildDir, "local.properties");
  
  // If local.properties already exists, don't overwrite it
  if (existsSync(localPropsPath)) {
    logger.info(`Using existing local.properties: ${localPropsPath}`);
    return;
  }

  // Try multiple methods to find Android SDK
  let {sdkPath} = findAndroidSdk()
  
  if (!sdkPath) {
    logger.error("Android SDK not found. Please install Android Studio or set ANDROID_HOME.");
    logger.info("You can manually create local.properties with:");
    logger.info("  sdk.dir=/path/to/your/android/sdk");
    throw new Error("Android SDK not found");
  }

  // Write the sdk.dir path with proper escaping for Windows
  const sdkDir = sdkPath.replace(/\\/g, "\\\\");
  fsSync.writeFileSync(localPropsPath, `sdk.dir=${sdkDir}\n`);
  logger.success(`Created local.properties → ${sdkPath}`);
}
function findKotlinFiles(dir: string): string[] {
  const files: string[] = [];
  const scanDir = (currentDir: string) => {
    const items = fsSync.readdirSync(currentDir);
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      if (fsSync.statSync(fullPath).isDirectory()) {
        scanDir(fullPath);
      } else if (item.endsWith('.kt')) {
        files.push(fullPath);
      }
    }
  };
  scanDir(dir);
  return files;
}
/* -----------------------------------------------------
   Patch MainActivity baseUrl
----------------------------------------------------- */
 async function patchMainActivity(buildDir: string, isDev: boolean) {
  const javaPath = path.join(buildDir, "app", "src", "main", "java");
  
  // Find MainActivity.kt
  function findMainActivity(dir) {
    const items = fsSync.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fsSync.statSync(fullPath).isDirectory()) {
        const found = findMainActivity(fullPath);
        if (found) return found;
      } else if (item === "MainActivity.kt") {
        return fullPath;
      }
    }
    return null;
  }
  
  const mainActivityPath = findMainActivity(javaPath);
  if (!mainActivityPath) throw new Error("MainActivity.kt not found");

  let content = fsSync.readFileSync(mainActivityPath, "utf8");
  
  // Get app ID for production URL
  const appId = config.app?.id || "myapp";
  
  // Set baseUrl based on dev/prod mode
  const baseUrl = isDev 
    ? `"http://${getLocalIP()}:3000/"`
    : `"file:///android_asset/${appId}/"`;
  
  console.log(`Setting baseUrl to: ${baseUrl} (isDev: ${isDev})`);
  
  // Update baseUrl in Kotlin file
  const baseUrlRegex = /private\s+var\s+baseUrl\s*=\s*"[^"]*"/;
  if (content.match(baseUrlRegex)) {
    content = content.replace(baseUrlRegex, `private var baseUrl = ${baseUrl}`);
  } else {
    // Try alternative pattern
    content = content.replace(
      /(var|val)\s+baseUrl\s*[=:]\s*"[^"]*"/,
      `var baseUrl = ${baseUrl}`
    );
  }
  
  await fs.writeFile(mainActivityPath, content);
  logger.success(`MainActivity patched → ${baseUrl} (${isDev ? 'DEV' : 'PROD'} mode)`);
}

/* -----------------------------------------------------
   Copy JS assets
----------------------------------------------------- */
async function copyAssets(buildDir: string) {
  const APP_ID = config.app?.id || "myapp";
  const assetsDir = path.join(buildDir, "app", "src", "main", "assets", APP_ID);
  if (existsSync(assetsDir)) rmSync(assetsDir, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });
  cpSync(DIST_DIR, assetsDir, { recursive: true });
  logger.success(`Assets copied → ${assetsDir}`);
}

 function patchPermissions(buildDir: string) {
  const manifestPath = path.join(buildDir, "app", "src", "main", "AndroidManifest.xml");
  if (!existsSync(manifestPath)) return;

  let content = fsSync.readFileSync(manifestPath, "utf8");
  
  // Remove existing permissions
  content = content.replace(/<uses-permission android:name="[^"]*" \/>/g, "");
  
  // Always add INTERNET permission (needed for dev mode)
  const basePerms = [
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'
  ];
  
  // Add permissions from config
  if (config.platforms?.android?.permissions) {
    const configPerms = config.platforms.android.permissions
      .map(p => `    <uses-permission android:name="${p}" />`);
    basePerms.push(...configPerms);
  }
  
  // Insert permissions after manifest opening tag
  content = content.replace(/<manifest[^>]*>/, `$&\n${basePerms.join('\n')}`);
  
  // Remove any WRONG <uses-cleartext-traffic> elements if they exist
  content = content.replace(/<uses-cleartext-traffic[^>]*\/>/g, '');
  
  // Add network security config for Android 9+ (for HTTP in dev mode)
  // This should be an ATTRIBUTE of the <application> tag, not a child element
  if (content.includes('<application')) {
    // Check if application already has usesCleartextTraffic attribute
    if (!content.includes('android:usesCleartextTraffic')) {
      // Add the attribute to the application tag
      content = content.replace(
        /<application([^>]*)>/,
        '<application$1 android:usesCleartextTraffic="true">'
      );
    } else {
      // If it exists, make sure it's set to true
      content = content.replace(
        /android:usesCleartextTraffic="[^"]*"/,
        'android:usesCleartextTraffic="true"'
      );
    }
  }
  
  fsSync.writeFileSync(manifestPath, content, "utf8");
  logger.success("Android permissions patched");
}

 function patchAppMeta(buildDir: string) {
  const resDir = path.join(buildDir, "app", "src", "main", "res");

  // Patch app icon (keep as is)
   if (config.platforms?.android?.icon) {
  const iconPath = path.join(PROJECT_ROOT, config.platforms.android.icon);
  if (!existsSync(iconPath)) {
    logger.warn(`Android icon not found at ${iconPath}, skipping.`);
  } else {
    const mipmaps = ["mipmap-hdpi", "mipmap-mdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"];
    for (const map of mipmaps) {
      // Replace the .webp file in the template
      const templateIcon = path.join(resDir, map, "ic_launcher.webp");
      if (existsSync(templateIcon)) {
        fsSync.copyFileSync(iconPath, templateIcon);
      } else {
        logger.warn(`Template icon not found: ${templateIcon}`);
      }
    }
    logger.success(`Launcher icon replaced in template → ${iconPath}`);
  }
}


  // Patch ONLY app name in strings.xml
  if (config.app?.name) {
    const stringsXml = path.join(resDir, "values", "strings.xml");
    if (existsSync(stringsXml)) {
      let content = fsSync.readFileSync(stringsXml, "utf8");
      content = content.replace(
        /<string name="app_name">.*<\/string>/,
        `<string name="app_name">${config.app.name}</string>`
      );
      fsSync.writeFileSync(stringsXml, content, "utf8");
      logger.success(`App name patched → ${config.app.name}`);
    }
  }
}

 function renamePackage(buildDir: string, newPackage: string) {
  const javaSrc = path.join(buildDir, "app", "src", "main", "java");
  
  console.log(`\n=== Package Rename to: ${newPackage} ===`);
  
  // 1. Find and update MainActivity.kt
  let mainActivityPath = null;
  
  // Search for MainActivity.kt
  function findFile(dir, filename) {
    if (!existsSync(dir)) return null;
    const items = fsSync.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fsSync.statSync(fullPath).isDirectory()) {
        const found = findFile(fullPath, filename);
        if (found) return found;
      } else if (item === filename) {
        return fullPath;
      }
    }
    return null;
  }
  
  mainActivityPath = findFile(javaSrc, "MainActivity.kt");
  
  if (mainActivityPath) {
    let content = fsSync.readFileSync(mainActivityPath, "utf8");
    
    // Update package declaration (com.example.myapplication → com.moviesplus.app)
    content = content.replace(
      /^package\s+[\w.]+/m,
      `package ${newPackage}`
    );
    
    fsSync.writeFileSync(mainActivityPath, content, "utf8");
    console.log(`✓ Updated MainActivity.kt package to: ${newPackage}`);
    
    // Move to correct directory
    const oldDir = path.dirname(mainActivityPath);
    const newDir = path.join(javaSrc, ...newPackage.split("."));
    
    if (oldDir !== newDir) {
      mkdirSync(newDir, { recursive: true });
      const newPath = path.join(newDir, "MainActivity.kt");
      fsSync.renameSync(mainActivityPath, newPath);
      console.log(`✓ Moved MainActivity.kt to: ${newDir}`);
      
      // Clean up old directory
      try {
        const oldFiles = fsSync.readdirSync(oldDir);
        if (oldFiles.length === 0) {
          rmSync(oldDir, { recursive: true, force: true });
        }
      } catch (e) {}
    }
  }
  
  // 2. Update AndroidManifest.xml
  const manifestPath = path.join(buildDir, "app", "src", "main", "AndroidManifest.xml");
  if (existsSync(manifestPath)) {
    let manifest = fsSync.readFileSync(manifestPath, "utf8");
    
    // Update package attribute
    manifest = manifest.replace(/package="[^"]*"/, `package="${newPackage}"`);
    
    fsSync.writeFileSync(manifestPath, manifest, "utf8");
    console.log(`✓ Updated AndroidManifest.xml package to: ${newPackage}`);
  }
  
  // 3. CRITICAL: Update build.gradle.kts - BOTH namespace AND applicationId
  const gradlePath = path.join(buildDir, "app", "build.gradle.kts");
  if (existsSync(gradlePath)) {
    let gradle = fsSync.readFileSync(gradlePath, "utf8");
    
    console.log(gradle)
    console.log("\n📝 Updating build.gradle.kts...");
    
    // Update namespace
    if (gradle.includes("namespace")) {
      gradle = gradle.replace(
        /namespace\s*=\s*["'][^"']*["']/,
        `namespace = "${newPackage}"`
      );
      console.log(`✓ Updated namespace to: ${newPackage}`);
    } else {
      // Add namespace after android {
      gradle = gradle.replace(
        /(android\s*\{)/,
        `$1\n    namespace = "${newPackage}"`
      );
      console.log(`✓ Added namespace: ${newPackage}`);
    }
    
    // CRITICAL FIX: Update applicationId
    if (gradle.includes("applicationId")) {
      gradle = gradle.replace(
        /applicationId\s*=\s*["'][^"']*["']/,
        `applicationId = "${newPackage}"`
      );
      console.log(`✓ Updated applicationId to: ${newPackage}`);
    } else {
      // Add applicationId in defaultConfig
      if (gradle.includes("defaultConfig")) {
        gradle = gradle.replace(
          /(defaultConfig\s*\{)/,
          `$1\n        applicationId = "${newPackage}"`
        );
        console.log(`✓ Added applicationId: ${newPackage}`);
      }
    }
    
    // Also check for applicationIdSuffix and remove if present
    gradle = gradle.replace(/applicationIdSuffix\s*=\s*["'][^"']*["']/g, '');
     
    fsSync.writeFileSync(gradlePath, gradle, "utf8");
  }
  
  // 4. Also update settings.gradle.kts if it has rootProject.name
  const settingsGradlePath = path.join(buildDir, "settings.gradle.kts");
  if (existsSync(settingsGradlePath)) {
    let settings = fsSync.readFileSync(settingsGradlePath, "utf8");
    
    // Update rootProject.name if it exists
    if (settings.includes("rootProject.name")) {
      const appName = config.app?.name || "MyApp";
      settings = settings.replace(
        /rootProject\.name\s*=\s*["'][^"']*["']/,
        `rootProject.name = "${appName}"`
      );
      fsSync.writeFileSync(settingsGradlePath, settings, "utf8");
      console.log(`✓ Updated rootProject.name to: ${appName}`);
    }
  }
  
  logger.success(`Package renamed to: ${newPackage}`);
}

// Helper function to escape regex special characters
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/* -----------------------------------------------------
   Main Android Build
----------------------------------------------------- */
export async function buildAndroid(isDev = false) {
   logger.step("Android Build");
  ensureAndroidInstalled();

  const APP_ID = config.app?.id || "com.vaderjs.app";
  const BUILD_SRC = path.join(PROJECT_ROOT, "node_modules", "vaderjs-native", "app-template");
  const BUILD_DIR = path.join(PROJECT_ROOT, "build", "android-src", APP_ID);

  // COMPLETELY remove old build directory
  if (existsSync(BUILD_DIR)) {
    console.log(`Cleaning old build: ${BUILD_DIR}`);
    rmSync(BUILD_DIR, { recursive: true, force: true });
  }
  
  // Create fresh directory
  mkdirSync(BUILD_DIR, { recursive: true });

  // Copy template
  console.log(`Copying template from: ${BUILD_SRC}`);
  cpSync(BUILD_SRC, BUILD_DIR, { recursive: true });

  // DO NOT delete myapp directory here - let renamePackage handle it
  // First rename package (this will move files from myapp to com/moviesplus/app)
  renamePackage(BUILD_DIR, APP_ID);

  // Clean up any leftover myapp directory AFTER renaming
  const oldMyAppDir = path.join(BUILD_DIR, "app", "src", "main", "java", "myapp");
  if (existsSync(oldMyAppDir)) {
    console.log(`Cleaning leftover myapp directory: ${oldMyAppDir}`);
    rmSync(oldMyAppDir, { recursive: true, force: true });
  }

  // Then: Apply other patches
  await ensureLocalProperties(BUILD_DIR);
  await patchMainActivity(BUILD_DIR, isDev);
  patchPermissions(BUILD_DIR);
  patchAppMeta(BUILD_DIR);
  await copyAssets(BUILD_DIR); 
  // Gradle build
  let gradleCmd = process.platform === "win32" ? path.join(BUILD_DIR, "gradlew.bat") : path.join(BUILD_DIR, "gradlew");
  if (!existsSync(gradleCmd)) gradleCmd = "gradle"; // fallback to global gradle

  logger.info("Running Gradle assembleDebug...");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(gradleCmd, ["assembleDebug"], { cwd: BUILD_DIR, stdio: "inherit", shell: true });
    proc.on("exit", code => (code === 0 ? resolve() : reject(new Error(`Gradle failed (${code})`))));
    proc.on("error", reject);
  });

  // Cleanup lingering Java processes
  try {
    if (process.platform === "win32") execSync("taskkill /F /IM java.exe /T", { stdio: "ignore" });
    else execSync("pkill -f java", { stdio: "ignore" });
  } catch {}

  // Copy APK
  const APK_SRC = path.join(BUILD_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  const APK_DEST_DIR = path.join(PROJECT_ROOT, "build");
  mkdirSync(APK_DEST_DIR, { recursive: true });
  const APK_DEST = path.join(APK_DEST_DIR, `${APP_ID}-debug.apk`);

  if (!existsSync(APK_SRC)) throw new Error("APK not found after build");
  copyFileSync(APK_SRC, APK_DEST);
  logger.success(`APK ready → ${APK_DEST}`);
}
