# VaderNative

**VaderNative** is a high-performance, reactive framework for building truly native cross-platform applications. It combines a familiar React-like developer experience with a "Native-First" philosophy—streaming logs to your terminal, bundling single-file executables, and maintaining a zero-Virtual-DOM overhead.

## 🛠 Developer Environment Setup

Before you start coding, ensure your machine is equipped for native compilation.

### 1. General Requirements

* **Bun:** [Install Bun](https://bun.sh) (Required for the CLI and Dev Server).
* **Node.js:** v18+ (For compatibility with certain native build tools).

### 2. Android Setup (Mobile)

To build and run on Android, you need the **Android SDK**:

* **Android Studio:** Install [Android Studio](https://developer.android.com/studio).
* **SDK Platform:** Ensure you have **SDK 34** (UpsideDownCake) installed via the SDK Manager.
* **Environment Variables:**
```bash
# Add to your .bashrc, .zshrc, or Windows ENV
ANDROID_HOME=$HOME/Android/Sdk
PATH=$PATH:$ANDROID_HOME/platform-tools


### 3. Windows Setup (Desktop)

To build **WinUI 3** native desktop apps:

* **Visual Studio 2022:** Install with the **.NET Desktop Development** workload.
* **.NET 8 SDK:** [Download here](https://dotnet.microsoft.com/download/dotnet/8.0).
* **Windows App SDK:** Managed automatically by the VaderNative build script.

## 🚀 Getting Started

### 1. Installation

```bash
bun install vaderjs-native@latest
```

### 2. Create your first page

```tsx
// App.tsx in root folder
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
  return <Component params={route.params} />;
}

Vader.render(<App />, document.getElementById("app")!);
```

```tsx
// src/router.tsx
import * as Vader from "vaderjs-native";
import { createRouter } from "vaderjs-native/router";
import Home from "../app/index";
import Login from "../app/login";
export const router = createRouter({
  mode: "history",
  routes: [
    { path: "/", component: Home },
    { path: "/login", component: Login },
    { path: "/login/", component: Login },
  ],
  fallback: function NotFound() {
    return <div>404 - Page Not Found</div>;
  },
});
```

```tsx
// app/index.tsx
import * as Vader from "vaderjs-native";
import { router } from "../src/router";

export default function Home() {
  Vader.useEffect(() => {
    (async () => {
      const token = await Vader.secureStore.get("auth_token");
      if (!token) {
        router.navigate("/login");
      }
    })();
  }, []);

  return <div>Hello World</div>;
}
```

## ⚙️ Configuration (`vaderjs.config.js`)

Control your app's DNA from a single config file:

```javascript
export default {
  app: {
    name: "MoviesPlus",
    id: "com.moviesplus.app",
    version: { code: 1, name: "1.0.0" },
  },
  platforms: {
    android: {
      minSdk: 24,
      targetSdk: 34,
      permissions: ["INTERNET"],
      icon: "./public/android-icon.png",
    },
    windows: {
      sdkVersion: "10.0.19041.0",
      icon: "./public/windows/icon.ico",
    }
  }
};
```

## 💻 CLI Commands & Workflow

VaderNative is designed for a **Terminal-First** workflow. No need to keep native IDEs (Android Studio/Visual Studio) open for debugging.

### Development Mode

Automatically syncs assets, starts the dev server, and streams native logs to your console.

```bash
# Web Development (SPA)
bun run vaderjs dev

# Windows Dev (Streams app.log to terminal)
bun run vaderjs windows:dev

# Android Dev
bun run vaderjs android:dev
```

### Production Building

Compile your app into a distributable format.

```bash
# Build for web
bun run vaderjs build

# Create a Single-File Windows EXE (/release/App.exe)
bun run vaderjs windows:build

# Build Android APK/Bundle
bun run vaderjs android:build

# Serve production build
bun run vaderjs serve
```

### Project Management

```bash
# Create a new Vader project
bun run vaderjs init [project-name]

# Add a Vader plugin
bun run vaderjs add <plugin-name>

# Remove a Vader plugin
bun run vaderjs remove <plugin-name>

# List installed plugins
bun run vaderjs list_plugins
```

## 🪵 Native Logging Strategy

VaderNative implements **Native Pipe & Log Tailing**. 
* **Windows:** The CLI tails `app.log` using a shared-access stream, ensuring you see crashes even if the app UI freezes.
* **Android:** The CLI automatically filters `logcat` to show only your app's specific tags.

## 🗂 Project Structure

| Directory | Description |
| --- | --- |
| `App.tsx` | **Root App Component:** Main entry point for your SPA/MPA |
| `src/` | **Logic:** Shared components, hooks, and business logic |
| `public/` | **Assets:** Images, fonts, and static data |
| `dist/` | **Build Output:** Generated web assets |
| `build/` | **Native Projects:** Generated native source code (WinUI/Android project files) |

## ✨ Why VaderNative?

* **Native Speed:** No heavy Virtual DOM; updates are sent directly to native views
* **Single-File Windows Apps:** No complex installers; just one `.exe`
* **Bun-First:** Leverages the fastest JS runtime for building and bundling
* **Modern Tooling:** Tail logs, auto-patch `.csproj`, and hot-reload from one terminal
* **File-Based Routing:** Automatic route generation from `src/pages/` or `src/routes/`
* **SPA/MPA Support:** Choose between Single Page or Multi Page Application architecture
* **Plugin System:** Extend functionality with community plugins
* **Hot Module Replacement:** Fast development with real-time updates
* **Cross-Platform:** Build for web, Android, and Windows from the same codebase
 

 
