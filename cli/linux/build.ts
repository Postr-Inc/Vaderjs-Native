
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

import { loadConfig } from "../../main";
import { Config } from "../../config/index.js";
import { fetchBinary } from "../binaries/fetch.js";
import { generateResources } from "./resources";

// @ts-ignore
import pkg from "../../package.json" assert { type: "json" };

const PROJECT_ROOT = process.cwd();

const DIST_DIR = path.join(PROJECT_ROOT, "dist");

const RELEASE_DIR = path.join(
    PROJECT_ROOT,
    "release",
    "linux"
);
const BUILD_DIR = path.join(PROJECT_ROOT, "build", "linux-src", "linux");
const APPDIR_BIN_DIR = path.join(
    RELEASE_DIR,
    "AppDir",
    "usr",
    "bin"
);

interface LinuxConfig {
    binaryName?: string;
    compiler?: string;
    buildProfile?: "Debug" | "Release";
    pkgConfigPackages?: string[];
    port?: number;
}

function logStep(message: string) {
    console.log(`\n=== ${message} ===`);
}

function logSuccess(message: string) {
    console.log(`✓ ${message}`);
}

function logInfo(message: string) {
    console.log(`ℹ️ ${message}`);
}

/* --------------------------- Configuration --------------------------- */

async function getLinuxConfig(): Promise<LinuxConfig> {
    const config: Config = await loadConfig();

    return {
        binaryName: config.app?.name || "VaderJSApp",
        compiler: "g++",
        buildProfile: config.platforms?.linux?.buildProfile || "Release",
        port: config.server.port || 5000,

        pkgConfigPackages: [
            "gtk+-3.0",
            "webkit2gtk-4.1",
            "libsoup-3.0"
        ],

        ...((config.platforms?.linux || {}) as LinuxConfig)
    };
}

/* --------------------------- Process Utilities --------------------------- */

function runCommand(
    command: string,
    args: string[],
    cwd = PROJECT_ROOT
): Promise<void> {

    return new Promise((resolve, reject) => {

        const child = spawn(command, args, {
            cwd,
            stdio: "inherit"
        });

        child.on("error", reject);

        child.on("close", code => {

            if (code === 0) {
                resolve();
            } else {
                reject(
                    new Error(
                        `${command} exited with code ${code}`
                    )
                );
            }

        });

    });
}

function captureCommand(
    command: string,
    args: string[],
    cwd = PROJECT_ROOT
): Promise<string> {

    return new Promise((resolve, reject) => {

        const child = spawn(command, args, { cwd });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", data => {
            stdout += data;
        });

        child.stderr.on("data", data => {
            stderr += data;
        });

        child.on("error", reject);

        child.on("close", code => {

            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(
                    new Error(
                        stderr || `${command} failed`
                    )
                );
            }

        });

    });
}

/* --------------------------- Template Initialization --------------------------- */

async function initLinuxTemplate(projectDir: string) {

    const binaryDir = await fetchBinary(
        "linux",
        pkg.binaryVersion
    );
 

    logInfo(`Linux template: ${binaryDir}`);

    await fs.mkdir(projectDir, {
        recursive: true
    });

    // Copy the original template into a fresh workspace.
    await fs.cp(binaryDir, projectDir, {
        recursive: true
    });

    logSuccess("Linux native template initialized.");
}

/* --------------------------- Native Source Patching --------------------------- */

async function patchNativeSource(projectDir: string) {

    const config: Config = await loadConfig();

    const sourceCpp = path.join(
        projectDir,
        "view.cpp"
    );

    let source = await fs.readFile(
        sourceCpp,
        "utf8"
    );

    const title = config.app?.name || "VaderJS App";

    const escapeCppString = (value: string) =>
        value
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r");

    const escapedTitle = escapeCppString(title);

    // Replace template placeholder if present.
    if (source.includes("$title")) {

        source = source.replace(
            /\$title/g,
            escapedTitle
        );

    } else {

        // Otherwise patch the existing set_title call.
        source = source.replace(
            /w\.set_title\s*\(\s*"[^"]*"\s*\)\s*;/,
            `w.set_title("${escapedTitle}");`
        );

    }

    if (source.includes("$title")) {
        throw new Error(
            "Failed to replace the application title."
        );
    }

    await fs.writeFile(
        sourceCpp,
        source,
        "utf8"
    );

    logSuccess("Native C++ source patched.");
}

/* --------------------------- Resource Generation --------------------------- */
async function findNativeProjectDir(rootDir: string): Promise<string> {
    const candidates = [
        rootDir,
        path.join(rootDir, "linux"),
        path.join(rootDir, "src"),
        path.join(rootDir, "linux", "src"),
    ];

    for (const dir of candidates) {
        try {
            await fs.access(path.join(dir, "view.cpp"));
            return dir;
        } catch {
            // Try the next candidate.
        }
    }

    throw new Error(
        `Could not find view.cpp after loading Linux template. Checked:\n${candidates.join("\n")}`
    );
}
async function embedFrontend(projectDir: string, isDev = false) {

    const indexFile = path.join(
        DIST_DIR,
        "index.html"
    );

    await fs.access(indexFile);

    logStep("Embedding frontend resources...");
 
    if(!isDev) {
        logInfo("Generating embedded resources...");
        await generateResources(
        DIST_DIR,
        projectDir
    );
    }
     

    await fs.access(
        path.join(projectDir, "resources.cpp")
    );

    await fs.access(
        path.join(projectDir, "resources.h")
    );

    logSuccess("Frontend embedded into C++ resources.");
}

/* --------------------------- Native Compilation --------------------------- */

async function compileLinux(
    projectDir: string,
    outputDir: string
): Promise<string> {

    const config = await getLinuxConfig();

    const sourceCpp = path.join(
        projectDir,
        "view.cpp"
    );

    const resourcesCpp = path.join(
        projectDir,
        "resources.cpp"
    );

    await fs.access(sourceCpp);
    await fs.access(resourcesCpp);

    const packages = config.pkgConfigPackages || [];

    const flags = await captureCommand(
        "pkg-config",
        [
            "--cflags",
            "--libs",
            ...packages
        ],
        projectDir
    );

    const webviewIncludeDir = path.join(
        projectDir,
        "webview",
        "core",
        "include"
    );

    await fs.access(
        path.join(webviewIncludeDir, "webview.h")
    );

    await fs.mkdir(outputDir, {
        recursive: true
    });

    const binaryName = (
        config.binaryName || "VaderJSApp"
    ).replace(/[^a-zA-Z0-9_-]/g, "-");

    const outputBinary = path.join(
        outputDir,
        binaryName
    );

  const devUrl = `http://localhost:${config.port || 5000}`;

const args = [
    "-std=c++17",

    config.buildProfile === "Debug"
        ? "-g"
        : "-O2",

    `-I${webviewIncludeDir}`,

    `-DVADER_DEV=${config.buildProfile === "Debug" ? 1 : 0}`,

    `-DVADER_DEV_URL=${JSON.stringify(devUrl)}`,

    sourceCpp,
    resourcesCpp,

    "-o",
    outputBinary,

    ...flags.split(/\s+/).filter(Boolean)
];

    logStep("Compiling C++ application...");

    logInfo(`Compiler: ${config.compiler}`);

    await runCommand(
        config.compiler || "g++",
        args,
        projectDir
    );

    await fs.chmod(
        outputBinary,
        0o755
    );

    logSuccess(
        `Native executable compiled: ${outputBinary}`
    );

    return outputBinary;
}

/* --------------------------- Release Publishing --------------------------- */

async function publishLinux(outputBinary: string) {

    await fs.mkdir(APPDIR_BIN_DIR, {
        recursive: true
    });

    const binaryName = path.basename(outputBinary);

    const releaseBinary = path.join(
        APPDIR_BIN_DIR,
        binaryName
    );

    // Overwrite only the final executable.
    // No recursive deletion of the existing release.
    await fs.copyFile(
        outputBinary,
        releaseBinary
    );

    await fs.chmod(
        releaseBinary,
        0o755
    );

    logSuccess(
        `Release executable published: ${releaseBinary}`
    );

    return releaseBinary;
}
async function findLinuxProjectDir(root: string): Promise<string> {
  const candidates = [
    root,
    path.join(root, "linux"),
    path.join(root, "src", "linux"),
  ];

  for (const dir of candidates) {
    try {
      await fs.access(path.join(dir, "view.cpp"));
      return dir;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    `Could not find view.cpp in Linux template. Checked:\n${candidates.join("\n")}`
  );
}
/* --------------------------- Main Build --------------------------- */

 export async function buildLinux(isDev = false) {
    if (process.platform !== "linux") {
        throw new Error(
            "Linux native compilation requires a Linux build environment."
        );
    }

    logStep(`Linux Build (${isDev ? "Development" : "Production"})`);

    let stagingDir: string | undefined;

    try {
        // Refresh native template on every build.
        await initLinuxTemplate(BUILD_DIR);

        const projectDir =  await findLinuxProjectDir(BUILD_DIR);

        await embedFrontend(projectDir, isDev);
        await fs.access(path.join(projectDir, "view.cpp"));

        logInfo(`Using native source: ${projectDir}`);

        await fs.access(path.join(DIST_DIR, "index.html"));

        stagingDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "vaderjs-linux-")
        );

        const stagingOutputDir = path.join(stagingDir, "output");

        logStep("Patching native source...");
        await patchNativeSource(projectDir);
 

        const outputBinary = await compileLinux(
            projectDir,
            stagingOutputDir
        );

        const releaseBinary = await publishLinux(outputBinary);

        logSuccess("Linux native build completed.");

        return releaseBinary;

    } finally {
        if (stagingDir) {
            await fs.rm(stagingDir, {
                recursive: true,
                force: true
            }).catch(error => {
                logInfo(`Temporary cleanup skipped: ${error.message}`);
            });
        }
    }
}

export default buildLinux;
