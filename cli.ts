#!/usr/bin/env bun
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import readline from "readline";

const cwd = process.cwd();

/* -------------------------------- utils -------------------------------- */
/* -------------------------------- utils -------------------------------- */
function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question + " ", (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function run(cmd: string, args: string[] = []) {
  const proc = Bun.spawn([cmd, ...args], { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

function logSection(title: string) {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

function getFlags() {
  return new Set(process.argv.slice(2));
}

/* ---------------------------- UI frameworks ---------------------------- */
const UI_FRAMEWORKS = {
  none: {
    name: "None (Basic)",
    runtimeDeps: [],
    devDeps: [],
  },

  daisyui: {
    name: "VaderUI (DaisyUI)",
    runtimeDeps: ["vaderjs-daisyui", "daisyui"],
    devDeps: ["tailwindcss", "postcss", "autoprefixer"],
    pluginImport: `import daisyui from "vaderjs-daisyui";`,
    pluginRef: "daisyui",
    requiresRootCss: true,
    requiresTailwindConfig: true,
  },
};

/* ------------------------------ initProject ------------------------------ */
export async function initProject(dir?: string) {
  console.log("🚀 Initializing Vader.js project");

  const projectDir = path.resolve(cwd, dir || ".");
  if (!fsSync.existsSync(projectDir)) await fs.mkdir(projectDir, { recursive: true });

  if (fsSync.readdirSync(projectDir).length) {
    const confirm = await ask("Directory is not empty. Continue? (y/n):");
    if (confirm !== "y") process.exit(0);
  }

  /* language */
  console.log("\nSelect language:");
  console.log("  1. JavaScript");
  console.log("  2. TypeScript");
  const useTypeScript = (await ask("Choose (1-2):")) === "2";
  const fileExt = useTypeScript ? "tsx" : "jsx";
  const configExt = useTypeScript ? "ts" : "js";

  /* framework */
  console.log("\nSelect UI framework:");
  const keys = Object.keys(UI_FRAMEWORKS);
  keys.forEach((k, i) => console.log(`  ${i + 1}. ${UI_FRAMEWORKS[k].name}`));
  const fwKey = keys[Number(await ask(`Choose (1-${keys.length}):`)) - 1];
  const framework = UI_FRAMEWORKS[fwKey];

  /* folders */
  logSection("📁 Creating folders");
  for (const d of ["app", "src", "public"]) {
    await fs.mkdir(path.join(projectDir, d), { recursive: true });
  }

  /* root.css */
  if (framework.requiresRootCss) {
    await fs.writeFile(
      path.join(projectDir, "root.css"),
      `@import "tailwindcss";\n@plugin "daisyui";\n`
    );
  }

  /* tailwind.config.js */
  if (framework.requiresTailwindConfig) {
    await fs.writeFile(
      path.join(projectDir, "tailwind.config.js"),
      `export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],

  safelist: [
    "btn",
    "btn-primary",
    "btn-secondary",
    "btn-accent",
    "alert",
    "alert-error",
    "card",
    "card-body",
    "badge",
    "badge-info",
  ],

  theme: { extend: {} },
  plugins: [require("daisyui")]
};
`
    );
  }

  /* --------------------- VITE-STYLE DAISYUI DEMO --------------------- */
  const appCode = `import * as Vader from "vaderjs-native";
import { useState } from "vaderjs-native";
import Button from "vaderjs-daisyui/Components/Actions/Button";

function Main() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-base-200 flex flex-col items-center justify-center">
      <div className="text-center mb-10">
        <h1 className="text-5xl font-bold">
          Vader<span className="text-primary">.js</span>
        </h1>
        <p className="opacity-70 mt-2">Next-gen UI, zero React</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 max-w-5xl w-full px-6">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Instant Reactivity</h2>
            <p>Signals + fibers, no virtual DOM tax.</p>
          </div>
        </div>

        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">DaisyUI Built-In</h2>
            <p>Accessible components styled with Tailwind.</p>
          </div>
        </div>

        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Multi-Platform</h2>
            <p>Web, Android, Windows from one codebase.</p>
          </div>
        </div>
      </div>

      <div className="mt-10 flex gap-4">
        <Button color="primary" onClick={() => setCount(count + 1)}>
          Count: {count}
        </Button>
        <Button color="secondary" onClick={() => setCount(0)}>
          Reset
        </Button>
      </div>

      <p className="mt-6 opacity-60 text-sm">
        Edit <code>app/index.${fileExt}</code> and save to reload
      </p>
    </div>
  );
}

Vader.render(Vader.createElement(Main), document.getElementById("app"));`;

  await fs.writeFile(path.join(projectDir, `app/index.${fileExt}`), appCode);

  /* ---------------- jsconfig (EXACT – DO NOT TOUCH) ---------------- */
  await fs.writeFile(
    path.join(projectDir, "jsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          jsx: "react",
          jsxFactory: "Vader.createElement",
          jsxFragmentFactory: "Fragment",
        },
        include: ["app", "src"],
      },
      null,
      2
    )
  );

  /* config */
  const name = path.basename(projectDir);
  const config = `${framework.pluginImport}
import defineConfig from "vaderjs-native/config";

export default defineConfig({
  app: {
    name: "${name}",
    id: "com.example.${name}",
    version: { code: 1, name: "1.0.0" },
  },
  platforms: {
    web: { title: "${name}", themeColor: "#111827" },
    windows: {
      publisher: "CN=VaderJS",
      icon: "./assets/windows/icon.png",
      executionAlias: "${name}",
      sdkVersion: "10.0.19041.0", 
      minSdkVersion: "10.0.17763.0"
    }
  },
  plugins: [${framework.pluginRef}]
});`;

  await fs.writeFile(path.join(projectDir, `vaderjs.config.${configExt}`), config);

  /* package.json */
  const pkgPath = path.join(projectDir, "package.json");
  const pkg = {
    name,
    version: "1.0.0",
    type: "module",
    dependencies: { "vaderjs-native": "latest" },
    devDependencies: {},
  };

  framework.runtimeDeps.forEach((d) => (pkg.dependencies[d] = "latest"));
  framework.devDeps.forEach((d) => (pkg.devDependencies[d] = "latest"));

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));

  logSection("📦 Installing dependencies");
  await run("bun", ["install"]);

  console.log("\n✅ Project ready!");
}

/* ------------------------------- plugins ------------------------------- */
export async function addPlugin(name: string) {
  const pkgName = name.startsWith("vaderjs-") ? name : `vaderjs-${name}`;
  await run("bun", ["add", pkgName]);

  const configPath = fsSync.existsSync("vaderjs.config.ts")
    ? "vaderjs.config.ts"
    : "vaderjs.config.js";

  let config = await fs.readFile(configPath, "utf8");
  const importName = pkgName.replace(/^vaderjs-/, "").replace(/-/g, "_");

  if (!config.includes(pkgName)) {
    config = `import ${importName} from "${pkgName}";\n` + config;
    config = config.replace(/plugins:\s*\[/, `plugins: [${importName}, `);
    await fs.writeFile(configPath, config);
  }
}

export async function removePlugin(name: string) {
  const pkgName = name.startsWith("vaderjs-") ? name : `vaderjs-${name}`;
  await run("bun", ["remove", pkgName]);
}

export async function listPlugins() {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  Object.keys(pkg.dependencies || {})
    .filter((d) => d.startsWith("vaderjs-"))
    .forEach((d) => console.log("•", d));
}
