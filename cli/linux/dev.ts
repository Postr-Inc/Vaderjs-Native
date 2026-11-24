import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { Glob } from "bun";
import { loadConfig } from "../../main"; 

const PROJECT_ROOT = process.cwd();
const BUILD_DIR = path.join(PROJECT_ROOT, "build", "linux-src", "linux");
const RELEASE_DIR = path.join(process.cwd(), "release", "linux", "AppDir", "usr", "bin");
export default async function openLinuxApp(isDebug = true) {
  const config = await loadConfig(); 
  const binDir = path.join(RELEASE_DIR, config.app?.name);
  const process = spawn(binDir, [], { stdio: "inherit", detached: false });
  return process;
}