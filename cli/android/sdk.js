import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "../logger.js";

export function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), "AppData", "Local", "Android", "Sdk"),
  ].filter(Boolean);

  for (const sdk of candidates) {
    const adb = path.join(
      sdk,
      "platform-tools",
      process.platform === "win32" ? "adb.exe" : "adb"
    );
    if (fs.existsSync(adb)) {
      return { sdkPath: sdk, adbPath: adb };
    }
  }
  return null;
}

export function ensureAndroidInstalled() {
  const sdk = findAndroidSdk();
  if (!sdk) {
    logger.error("adb not found");
    console.log(`
Install Android Studio:
https://developer.android.com/studio

Enable:
✔ Android SDK
✔ Platform Tools
✔ Emulator
`);
    process.exit(1);
  }
  return sdk;
}
