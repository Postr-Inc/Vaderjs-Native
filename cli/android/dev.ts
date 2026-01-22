import path from "path";
import { execSync, spawnSync } from "child_process";
import { ensureAndroidInstalled } from "../../cli/android/sdk.js";
import { buildAndroid } from "../../cli/android/build.js";
import { logger } from "../../cli/logger.js";
import runDevServer from "../../cli/web/server.js";
import { loadConfig } from "../../main.js";
import { Config } from "../../config";
import fsSync from "fs";
const config: Config = await loadConfig();

export async function androidDev() {
  const { sdkPath, adbPath } = ensureAndroidInstalled();

  // Build Android APK in dev mode
  await buildAndroid(true);

  // Determine APK path dynamically
  const appId = config.app?.id || "com.vaderjs.app";
  const APK_PATH = path.join(process.cwd(), "build", `${appId}-debug.apk`);

  if (!fsSync.existsSync(APK_PATH)) {
    throw new Error(`APK not found at ${APK_PATH}`);
  }

  // Check connected devices
  let devices = execSync(`"${adbPath}" devices`, { encoding: "utf8" })
    .split("\n")
    .filter(l => l.endsWith("\tdevice"));

  // Start emulator if no devices
  if (!devices.length) {
    logger.warn("No devices found, starting emulator…");

    const emulator = path.join(
      sdkPath,
      "emulator",
      process.platform === "win32" ? "emulator.exe" : "emulator"
    );

    spawnSync(emulator, ["-avd", "Pixel_6_API_34"], {
      detached: true,
      stdio: "ignore",
    });

    execSync(`"${adbPath}" wait-for-device`);
  }

  logger.step("Installing APK");

  // Install APK on device/emulator
  execSync(`"${adbPath}" install -r "${APK_PATH}"`, { stdio: "inherit" });
  logger.success("APK installed");
  // Start dev server
  await runDevServer();
  // Launch the app 
  logger.step("Launching app on device/emulator");
  execSync(`"${adbPath}" shell am start -n "${appId}/com.${appId.split('.').slice(1).join('.')}.MainActivity"`, { stdio: "inherit" });

  logger.success("Android dev running 🚀");
}
