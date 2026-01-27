import path from "path";
import { execSync, spawn } from "child_process";
import fsSync from "fs";

import { ensureAndroidInstalled } from "../../cli/android/sdk.js";
import { buildAndroid } from "../../cli/android/build.js";
import { logger } from "../../cli/logger.js";
import runDevServer from "../../cli/web/server.js";
import { loadConfig } from "../../main.js";
import { Config } from "../../config";

export async function androidDev() {
  const config: Config = await loadConfig();
  const { sdkPath, adbPath } = ensureAndroidInstalled();

  const emulatorBin = path.join(
    sdkPath,
    "emulator",
    process.platform === "win32" ? "emulator.exe" : "emulator"
  );

  // ----------------------------
  // Start dev server
  // ----------------------------
  logger.info("Starting dev server...");
  const devServerPromise = runDevServer();

  await new Promise(resolve => setTimeout(resolve, 2000));

  // ----------------------------
  // Build Android (dev)
  // ----------------------------
  await buildAndroid(true);

  const appId = config.app?.id || "com.vaderjs.app";
  const APK_PATH = path.join(process.cwd(), "build", `${appId}-debug.apk`);

  if (!fsSync.existsSync(APK_PATH)) {
    throw new Error(`APK not found at ${APK_PATH}`);
  }

  // ----------------------------
  // Check connected devices
  // ----------------------------
const getDevices = () =>
  execSync(`"${adbPath}" devices`, { encoding: "utf8" })
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("List"))
    .filter(l => l.includes("device") && !l.includes("offline"));

  let devices = getDevices();

  // ----------------------------
  // List available AVDs
  // ----------------------------
  let emulators: string[] = [];
  try {
    emulators = execSync(`"${emulatorBin}" -list-avds`, { encoding: "utf8" })
      .split("\n")
      .map(e => e.trim())
      .filter(Boolean);
  } catch {
    logger.warn("Could not list Android emulators");
  }

  // ----------------------------
  // Start emulator if needed
  // ----------------------------
  if (!devices.length && emulators.length > 0) {
    const avd = emulators[0];
    logger.warn(`No devices found, starting emulator: ${avd}`);

    spawn(
      emulatorBin,
      ["-avd", avd, "-netdelay", "none", "-netspeed", "full"],
      {
        detached: true,
        stdio: "ignore",
      }
    );

    // Wait for emulator to connect
    logger.info("Waiting for emulator device...");
    execSync(`"${adbPath}" wait-for-device`);

    // Wait for Android to fully boot
    logger.info("Waiting for Android to boot...");
    execSync(
      `"${adbPath}" shell while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done`,
      { stdio: "inherit" }
    );

    logger.success("Emulator booted");
  }

  // ----------------------------
  // Verify device exists
  // ----------------------------
  devices = getDevices();
  if (!devices.length) {
    throw new Error("No Android devices available");
  }

  // ----------------------------
  // Install APK
  // ----------------------------
  logger.step("Installing APK");
  execSync(`"${adbPath}" install -r "${APK_PATH}"`, { stdio: "inherit" });
  logger.success("APK installed");

  // ----------------------------
  // Launch app
  // ----------------------------
  const activity = `${appId}/.MainActivity`;


  logger.step("Launching app");
  execSync(`"${adbPath}" shell am start -n "${activity}"`, {
    stdio: "inherit",
  });

  logger.success("Android dev running 🚀 — HMR active");

  // ----------------------------
  // Keep dev server alive
  // ----------------------------
  await devServerPromise;
}
