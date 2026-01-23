import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { loadConfig } from "../../main";
import { Config } from "../../config/index";

const PROJECT_ROOT = process.cwd();
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const BUILD_DIR = path.join(PROJECT_ROOT, "build", "windows-src");
const WINUI_TEMPLATE = path.join(PROJECT_ROOT, "node_modules", "vaderjs-native", "templates", "windows");

const templateCache = new Map<string, { mtime: number; content: string }>();

function logStep(msg: string) { console.log(`\n=== ${msg} ===`); }
function logSuccess(msg: string) { console.log(`✓ ${msg}`); }
function logInfo(msg: string) { console.log(`ℹ️  ${msg}`); }

interface WindowsConfig {
    publisher: string;
    icon: string;
    executionAlias: string;
    sdkVersion: string;
    minSdkVersion: string;
    customCsproj?: string;
    customMainWindow?: string;
    outputDir?: string;
    buildProfile?: 'Debug' | 'Release' | string;
}

async function getWindowsConfig(): Promise<WindowsConfig> {
    const config: Config = await loadConfig();
    const defaultConfig: WindowsConfig = {
        publisher: "CN=MyApp",
        icon: "./public/windows/icon.ico",
        executionAlias: "my-app",
        sdkVersion: "10.0.19041.0",
        minSdkVersion: "10.0.17763.0"
    };
    const envConfig = process.env.WINDOWS_CONFIG ? JSON.parse(process.env.WINDOWS_CONFIG) : {};
    return { ...defaultConfig, ...(config.platforms.windows || {}), ...envConfig };
}

async function copyWithCache(source: string, target: string): Promise<void> {
    const stat = await fs.stat(source);
    let needsCopy = true;
    try {
        const targetStat = await fs.stat(target);
        const cached = templateCache.get(source);
        if (cached && cached.mtime === stat.mtimeMs && targetStat.mtimeMs >= stat.mtimeMs) {
            needsCopy = false;
        }
    } catch {}

    if (needsCopy) {
        if (stat.isDirectory()) {
            await fs.mkdir(target, { recursive: true });
            const entries = await fs.readdir(source, { withFileTypes: true });
            await Promise.all(entries.map(entry => copyWithCache(path.join(source, entry.name), path.join(target, entry.name))));
        } else {
            await fs.copyFile(source, target);
            templateCache.set(source, { mtime: stat.mtimeMs, content: await fs.readFile(source, 'utf8') });
        }
    }
}

 async function updateAssetsIfNeeded(sourceDir: string, targetDir: string): Promise<boolean> {
    try {
        // 1. Ensure the parent directory of the target exists
        await fs.mkdir(path.dirname(targetDir), { recursive: true });

        // 2. Clear out the old web files to ensure a clean sync
        await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});

        // 3. Copy the fresh assets from /dist to the WinUI Web folder
        await fs.cp(sourceDir, targetDir, { recursive: true });
        
        return true;
    } catch (error) {
        console.error(`Failed to copy assets: ${error}`);
        return false;
    }
}
async function patchMainWindow(isDev: boolean, title: string, projectDir: string) {
    const config: Config = await loadConfig();
    const windowsConfig = await getWindowsConfig();
    const mainCsPath = path.join(projectDir, "MainWindow.xaml.cs");

    logStep("Patching MainWindow.xaml.cs");

    let content: string;
    if (windowsConfig.customMainWindow) {
        content = await fs.readFile(path.resolve(PROJECT_ROOT, windowsConfig.customMainWindow), "utf8");
    } else {
        content = await fs.readFile(mainCsPath, "utf8");
    }

    if (!windowsConfig.customMainWindow) {
        if (isDev) {
            const os = require("os");
            const interfaces = os.networkInterfaces();
            let localIP = "127.0.0.1";
            for (const list of Object.values(interfaces)) {
                for (const iface of (list as any[]) || []) {
                    if (iface.family === "IPv4" && !iface.internal) { localIP = iface.address; break; }
                }
            }
            const devUrl = `http://${localIP}:${config.port}/index.html`;
            content = content.replace(/WebViewUrl\s*=\s*.*?;/, `WebViewUrl = "${devUrl}";`);
        }
        const titleRegex = /(this\.Title\s*=\s*").*?(")/;
        content = content.replace(titleRegex, `$1${title}$2`);
    }
    await fs.writeFile(mainCsPath, content, "utf8");
}

async function patchCsproj(projectDir: string, folderName: string) {
    logStep(`Patching ${folderName}.csproj`);
    const windowsConfig = await getWindowsConfig();
    const csprojPath = path.join(projectDir, `${folderName}.csproj`);

    if (windowsConfig.customCsproj) {
        await fs.copyFile(path.resolve(PROJECT_ROOT, windowsConfig.customCsproj), csprojPath);
        return;
    }

    let csproj = await fs.readFile(csprojPath, "utf8");

    // 1. Update TargetFramework
    csproj = csproj.replace(
        /<TargetFramework>.*?<\/TargetFramework>/, 
        `<TargetFramework>net8.0-windows${windowsConfig.sdkVersion}</TargetFramework>`
    );

    // 2. Add Single-File Support Flags (The Fix)
    if (!csproj.includes("<EnableMsixTooling>")) {
        csproj = csproj.replace(
            /<\/PropertyGroup>/, // Adds to the first property group
            `  <EnableMsixTooling>true</EnableMsixTooling>
    <PublishSingleFile>true</PublishSingleFile>
  </PropertyGroup>`
        );
    }

    // 3. Ensure Web folder is included as Content
    if (!csproj.includes("<Content Include=\"Web\\**\\*.*\">")) {
        csproj = csproj.replace(
            /<\/Project>/,
            `
  <ItemGroup>
    <Content Include="Web\\**\\*.*">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
  </ItemGroup>
</Project>`
        );
    }

    await fs.writeFile(csprojPath, csproj, "utf8");
}

async function killExistingProcess(exeName: string) {
    try {
        const exeWithExt = exeName.endsWith(".exe") ? exeName : `${exeName}.exe`;
        require("child_process").execSync(`taskkill /F /IM "${exeWithExt}" /T`, { stdio: 'ignore', windowsHide: true });
    } catch {}
}
 export async function buildWindows(isDev = false) {
    const config = await loadConfig();
    const windowsConfig = await getWindowsConfig();
    const exeName = config.app.name;

    logStep(`Windows Build (${isDev ? "Dev" : "Prod"})`);
    await killExistingProcess(exeName);

    // --- TEMPLATE INITIALIZATION ---
    // This ensures the App1/App1 structure exists before we try to patch it
    const buildDirExists = await fs.stat(BUILD_DIR).catch(() => null);
    if (!buildDirExists) {
        logInfo("Initializing windows-src from template...");
        await fs.mkdir(BUILD_DIR, { recursive: true });
        await copyWithCache(WINUI_TEMPLATE, BUILD_DIR);
        logSuccess("Template copied successfully");
    }

    const projectFolderName = "App1"; 
    const projectDir = path.join(BUILD_DIR, projectFolderName, projectFolderName);
    const webDir = path.join(projectDir, "Web");

    // Ensure assets are copied into the project before building/publishing
    await updateAssetsIfNeeded(DIST_DIR, webDir);
    
    // This function must now also ensure <OutputType>WinExe</OutputType> is set
    await patchCsproj(projectDir, projectFolderName);
    await patchMainWindow(isDev, exeName, projectDir);

    const csprojPath = path.join(projectDir, `${projectFolderName}.csproj`);

    if (isDev) {
        logStep("Running Development Build...");
        await runCommand("dotnet", [
            "build", csprojPath, 
            "-c", "Debug", 
            `-p:AssemblyName=${exeName}`, 
            "-p:OutputType=WinExe", // Force windowed mode
            "--nologo"
        ]);
    } else {
        logStep("Creating Single-File Executable...");
        await runCommand("dotnet", [
            "publish", csprojPath,
            "-c", "Release",
            "-r", "win-x64",
            "--self-contained", "true",
            "-p:PublishSingleFile=true",
            "-p:IncludeNativeLibrariesForSelfExtract=true",
            "-p:EnableMsixTooling=true", // Required for SingleFile + WinUI
            "-p:OutputType=WinExe",      // Force windowed mode
            `-p:AssemblyName=${exeName}`,
            "-o", path.join(PROJECT_ROOT, "release")
        ]);
        logSuccess(`Production executable created in /release/${exeName}.exe`);
    }
}

// Helper to handle process spawning
async function runCommand(cmd: string, args: string[]) {
    return new Promise<void>((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: "inherit", windowsHide: true });
        p.on("exit", code => (code === 0 ? resolve() : reject(new Error(`${cmd} failed`))));
    });
}