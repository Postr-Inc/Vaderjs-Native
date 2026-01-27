import path from "path";
import os from "os";
import fs from "fs";
import fsPromises from "fs/promises";
import https from "https";
import extract from "extract-zip";
import { logger } from "../logger.js";

const CACHE_ROOT = path.join(os.homedir(), ".vaderjs", "binaries");

async function download(url: string, dest: string) {
  return new Promise<void>((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed (${res.statusCode}) → ${url}`));
        return;
      }

      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    }).on("error", reject);
  });
}

export async function fetchBinary(
  platform: "android" | "windows" | "linux",
  version: string
): Promise<string> {
  const platformDir = path.join(CACHE_ROOT, version, platform);
  const marker = path.join(platformDir, ".ready");

  if (fs.existsSync(marker)) {
    logger.info(`📦 Using cached ${platform} binaries (${version})`);
    return platformDir;
  }

  logger.info(`⬇️ Downloading ${platform} binaries v${version}`);

  await fsPromises.mkdir(platformDir, { recursive: true });

  const zipPath = path.join(platformDir, `${platform}.zip`);
  const url = `https://github.com/Postr-Inc/Vaderjs-Native-Binaries/releases/download/${version}/${platform}.zip`;

  await download(url, zipPath);

  logger.info(`📂 Extracting ${platform}.zip`);
  await extract(zipPath, { dir: platformDir });

  await fsPromises.unlink(zipPath);
  await fsPromises.writeFile(marker, "ok");

  logger.success(`✅ ${platform} binaries ready`);
  return platformDir;
}
