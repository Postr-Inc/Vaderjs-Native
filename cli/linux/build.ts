import os from "os";
import fs from "fs/promises";
import { exec } from "child_process";
import path from "path";
import { fetchBinary } from "../binaries/fetch";
import { Config } from "../../config/index.js";
import pkg from "../../package.json" assert { type: "json" };
import { loadConfig } from "../../main";
import { logger } from "../logger";

const linuxDistributions = [
  "ubuntu",
  "debian",
  "fedora",
  "centos",
  "red hat",
  "arch linux",
  "manjaro",
  "opensuse",
  "linux mint",
  "elementary os",
  "zorin os",
  "pop!_os",
  "kali linux",
  "alpine linux",
];

export async function getLinuxDistribution(): Promise<string> {
  const osRelease = await fs.readFile("/etc/os-release", "utf8").catch(() => "");
  const normalized = `${osRelease} ${os.release()}`.toLowerCase();

  for (const distro of linuxDistributions) {
    if (normalized.includes(distro)) {
      return distro;
    }
  }

  return "unknown";
}

export function getInstallCommand(distro: string | null): string {
  const target = (distro || "unknown").toLowerCase();

  switch (target) {
    case "ubuntu":
    case "debian":
    case "linux mint":
    case "elementary os":
      return "sudo apt update && sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev";

    case "fedora":
    case "red hat":
    case "centos":
      return "sudo dnf install -y gtk3-devel webkit2gtk4.1-devel";

    case "arch linux":
    case "manjaro":
      return "sudo pacman -S --needed gtk3 webkit2gtk";

    case "opensuse":
      return "sudo zypper install -y gtk3-devel webkit2gtk3-devel";

    case "alpine linux":
      return "sudo apk add gtk+3.0 webkit2gtk-dev";

    default:
      return "Please install GTK3 and WebKit2GTK using your distro's package manager.";
  }
}

export async function ensureWebView() {
  const installed = await hasWebKit();

  if (!installed) {
    logger.error("WebKit2GTK not found.");
    logger.error("Install with your package manager (e.g. apt, pacman, dnf).");
    process.exit(1);
  }
}

function hasWebKit(): Promise<boolean> {
  return new Promise((resolve) => {
    exec("pkg-config --exists webkit2gtk-4.1", (err) => {
      resolve(!err);
    });
  });
}

async function getPkgConfigFlags(): Promise<string> {
  return new Promise((resolve, reject) => {
    exec("pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1", (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function patchProjectFile(cprojPath: string, isDev: boolean): Promise<void> {
  const config: Config = await loadConfig(process.cwd());
  const interfaces = os.networkInterfaces();
  let localIP = "127.0.0.1";

  for (const list of Object.values(interfaces)) {
    for (const iface of (list as any[]) || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  let fileData = await fs.readFile(cprojPath, "utf8");
  fileData = fileData.replace(/\$title/g, config.app?.name || "VaderJS App");

  const resolvedPath = isDev
    ? `http://${localIP}:${config.port}/index.html`
    : `file://${path.join(process.cwd(), "build", "linux", config.app?.id || "com.vaderjs.app", "web", "index.html")}`;

  fileData = fileData.replace(/\$filePath/g, resolvedPath);
  await fs.writeFile(cprojPath, fileData, "utf8");
}

export default async function linuxBuild() {
  console.log("Building for Linux...");

  const distro = await getLinuxDistribution();
  const webKitInstalled = await hasWebKit();

  if (!webKitInstalled && os.platform() === "linux") {
    console.error("WebKit2GTK is not installed. Please install it before building.");
    logger.step(`Install command: ${getInstallCommand(distro)}`);
    process.exit(1);
  }

  console.log("WebKit2GTK is installed. Proceeding with build...");

  const BUILD_SRC = await fetchBinary("linux", pkg.binaryVersion);
  const config: Config = await loadConfig(process.cwd());
  const BUILD_DEST = path.join(process.cwd(), "build", "linux", config.app?.id || "com.vaderjs.app");

  logger.step(`Copying build files to ${BUILD_DEST}...`);
  await fs.mkdir(BUILD_DEST, { recursive: true });
  await fs.cp(BUILD_SRC, BUILD_DEST, { recursive: true });

  const projectFolderName = config.app?.name || "VaderJSApp";
  const projectDir = path.join(BUILD_DEST, projectFolderName, projectFolderName);
  const webDir = path.join(projectDir, "Web");

  await fs.mkdir(webDir, { recursive: true });
  await fs.cp(path.join(process.cwd(), "build", "web"), webDir, { recursive: true });

  const cprojPath = path.join(projectDir, `${projectFolderName}.csproj`);
  await patchProjectFile(cprojPath, false);

  const sourceCpp = path.join(projectDir, "view.cpp");
  const outputBinary = path.join(projectDir, "app");
  const compileFlags = await getPkgConfigFlags();

  const buildCommand = `g++ -std=c++17 "${sourceCpp}" -o "${outputBinary}" ${compileFlags}`;

  logger.step(`Building C++ project with command: ${buildCommand}`);

  await new Promise<void>((resolve, reject) => {
    exec(buildCommand, { cwd: projectDir }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error building C++ project: ${error.message}`);
        reject(error);
        return;
      }

      if (stderr) {
        console.error(`Build stderr: ${stderr}`);
      }

      if (stdout) {
        console.log(stdout);
      }

      resolve();
    });
  });

  logger.success("C++ project built successfully.");
}
