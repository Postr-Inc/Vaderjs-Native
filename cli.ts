#!/usr/bin/env bun
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import readline from "readline";

const cwd = process.cwd();

/* ------------------------------------------------ utils ------------------------------------------------ */

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve =>
    rl.question(question + " ", ans => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function run(cmd: string, args: string[] = []) {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

function logSection(title: string) {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

/* ------------------------------------------------ frameworks ------------------------------------------------ */

const UI_FRAMEWORKS: Record<string, any> = {
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

/* ------------------------------------------------ project generator ------------------------------------------------ */

export async function initProject(dir?: string) {
  console.log("🚀 Initializing Vader.js project");

  const projectDir = path.resolve(cwd, dir || ".");

  if (!fsSync.existsSync(projectDir)) {
    await fs.mkdir(projectDir, { recursive: true });
  }

  if (fsSync.readdirSync(projectDir).length) {
    const confirm = await ask("Directory is not empty. Continue? (y/n):");
    if (confirm !== "y") process.exit(0);
  }

  /* ---------------- language ---------------- */

  console.log("\nSelect language:");
  console.log("  1. JavaScript");
  console.log("  2. TypeScript");

  const useTypeScript = (await ask("Choose (1-2):")) === "2";

  const fileExt = useTypeScript ? "tsx" : "jsx";
  const configExt = useTypeScript ? "ts" : "js";

  /* ---------------- port ---------------- */

  const port = (await ask("Enter dev server port (default 5173):")) || "5173";

  /* ---------------- framework ---------------- */

  console.log("\nSelect UI framework:");

  const keys = Object.keys(UI_FRAMEWORKS);
  keys.forEach((k, i) => {
    console.log(`  ${i + 1}. ${UI_FRAMEWORKS[k].name}`);
  });

  const fwKey = keys[Number(await ask(`Choose (1-${keys.length}):`)) - 1];
  const framework = UI_FRAMEWORKS[fwKey];

  /* ------------------------------------------------ folders ------------------------------------------------ */

  logSection("📁 Creating project structure");

  for (const d of ["app", "src", "public"]) {
    await fs.mkdir(path.join(projectDir, d), { recursive: true });
  }

  /* ------------------------------------------------ framework configs ------------------------------------------------ */

  if (framework.requiresRootCss) {
    await fs.writeFile(
      path.join(projectDir, "root.css"),
      `@import "tailwindcss";
@plugin "daisyui";
`
    );
  }

  if (framework.requiresTailwindConfig) {
    await fs.writeFile(
      path.join(projectDir, "tailwind.config.js"),
      `export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],

  theme: { extend: {} },

  plugins: [require("daisyui")]
};
`
    );
  }

  /* ------------------------------------------------ app/index template ------------------------------------------------ */

  const appIndexTemplate = framework.pluginRef
    ? `
import * as Vader from "vaderjs-native";
import { useState } from "vaderjs-native";
import Button from "vaderjs-daisyui/Components/Actions/Button";

function Main() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-base-200">
      <h1 className="text-5xl font-bold">
        Vader<span className="text-primary">.js</span>
      </h1>

      <div className="mt-10 flex gap-4">
        <Button color="primary" onClick={() => setCount(count + 1)}>
          Count: {count}
        </Button>

        <Button color="secondary" onClick={() => setCount(0)}>
          Reset
        </Button>
      </div>
    </div>
  );
}

export default Main;
`
    : `
import * as Vader from "vaderjs-native";
import { useState } from "vaderjs-native";

function Main() {
  const [count, setCount] = useState(0);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "sans-serif"
    }}>
      <h1>Vader.js</h1>

      <p>Zero plugin runtime.</p>

      <button onClick={() => count + 1}>
        Count: {count}
      </button>
    </div>
  );
}

export default Main;
`;

  await fs.writeFile(
    path.join(projectDir, `app/index.${fileExt}`),
    appIndexTemplate
  );

  /* ------------------------------------------------ Router scaffold ------------------------------------------------ */

  const routerCode = `
import * as Vader from "vaderjs-native";
import { createRouter } from "vaderjs-native/router";
import Main from "../app/index";

export const router = createRouter({
  routes: [
    {
      path: "/",
      component: Main,
    },
  ],

  fallback: function NotFound() {
    return <div style={{
      padding: "40px",
      textAlign: "center",
      fontFamily: "sans-serif"
    }}>
      404 - Page Not Found
    </div>;
  },
});
`;

  await fs.writeFile(
    path.join(projectDir, "src/router.tsx"),
    routerCode
  );

  /* ------------------------------------------------ App.tsx wrapper ------------------------------------------------ */

  const appWrapper = `
import * as Vader from "vaderjs-native";
import { useRoute } from "vaderjs-native/router";
import { router } from "./src/router";

function App() {
  const route = useRoute();

  if (!route) {
    const Fallback = router.getFallback();
    return <Fallback />;
  }

  const Component = route.route.component;
  return <Component />;
}

export default App;
`;

  await fs.writeFile(path.join(projectDir, "App.tsx"), appWrapper);

  /* ------------------------------------------------ jsconfig ------------------------------------------------ */

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

  /* ------------------------------------------------ config ------------------------------------------------ */

  const name = path.basename(projectDir);

  const pluginImport = framework.pluginImport
    ? framework.pluginImport + "\n"
    : "";

  const pluginsArray = framework.pluginRef
    ? `[${framework.pluginRef}]`
    : `[]`;

  const config = `
${pluginImport}
import defineConfig from "vaderjs-native/config";

export default defineConfig({
  server: {
    port: ${port}
  },

  app: {
    name: "${name}",
    id: "com.example.${name}",
    version: { code: 1, name: "1.0.0" },
  },

  platforms: {
    web: {
      title: "${name}",
      themeColor: "#111827"
    }
  },

  plugins: ${pluginsArray}
});
`;

  await fs.writeFile(
    path.join(projectDir, `vaderjs.config.${configExt}`),
    config
  );

  /* ------------------------------------------------ package.json ------------------------------------------------ */

  const pkg = {
    name,
    version: "1.0.0",
    type: "module",
    dependencies: {
      "vaderjs-native": "latest",
    },
    devDependencies: {},
  };

  framework.runtimeDeps?.forEach((d: string) => {
    pkg.dependencies[d] = "latest";
  });

  framework.devDeps?.forEach((d: string) => {
    pkg.devDependencies[d] = "latest";
  });

  await fs.writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify(pkg, null, 2)
  );

  logSection("📦 Installing dependencies");

  await run("bun", ["install"]);

  console.log(`\n✅ Project ready → http://localhost:${port}`);
}
