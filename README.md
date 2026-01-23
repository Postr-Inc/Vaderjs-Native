## <p align="center">

<a href="[https://vader-js.pages.dev](https://vader-js.pages.dev)">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="/icon.jpeg">
<img src="[https://github.com/Postr-Inc/Vader.js/blob/main/logo.png](https://github.com/Postr-Inc/Vader.js/blob/main/logo.png)" height="128">
</picture>
<h1 align="center">VaderNative</h1>
</a>
</p>

**VaderNative** is a high-performance, reactive framework for building truly native cross-platform applications. It combines a familiar React-like developer experience with a "Native-First" philosophy—streaming logs to your terminal, bundling single-file executables, and maintaining a zero-Virtual-DOM overhead.

---

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

```



### 3. Windows Setup (Desktop)

To build **WinUI 3** native desktop apps:

* **Visual Studio 2022:** Install with the **.NET Desktop Development** workload.
* **.NET 8 SDK:** [Download here](https://dotnet.microsoft.com/download/dotnet/8.0).
* **Windows App SDK:** Managed automatically by the VaderNative build script.

---

## 🚀 Getting Started

### 1. Installation

```bash
bun install vaderjs@latest

```

### 2. Create your first page

VaderNative uses **File-Based Routing**. Create a file at `app/index.jsx`:

```tsx
import * as Vader from "vader-native";

export default function App() {
  const [count, setCount] = Vader.useState(0);

  return (
    <div style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontSize: 24 }}>Count: {count}</p>
      <button title="Increment" onPress={() => setCount(count + 1)} />
    </div>
  );
}

```

---

## ⚙️ Configuration (`vader.config.ts`)

Control your app's DNA from a single config file:

```ts
import defineConfig from "vaderjs-native/config";

export default defineConfig({
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
});

```

---

## 💻 CLI Commands & Workflow

VaderNative is designed for a **Terminal-First** workflow. No need to keep native IDEs (Android Studio/Visual Studio) open for debugging.

### Development Mode

Automatically syncs assets, starts the dev server, and streams native logs to your console.

```bash
# Run Windows Dev (Streams app.log to terminal)
bun dev windows:dev

# Run Android Dev
bun dev android:dev

```

### Production Building

Compile your app into a distributable format.

```bash
# Create a Single-File Windows EXE (/release/App.exe)
bun build windows:build

# Build Android APK/Bundle
bun build android:build

```

---

## 🪵 Native Logging Strategy

VaderNative implements **Native Pipe & Log Tailing**. 
* **Windows:** The CLI tails `app.log` using a shared-access stream, ensuring you see crashes even if the app UI freezes.
* **Android:** The CLI automatically filters `logcat` to show only your app's specific tags.

---

## 🗂 Project Structure

| Directory | Description |
| --- | --- |
| `app/` | **Routes:** File-based routing (e.g., `index.jsx`, `settings.jsx`). |
| `src/` | **Logic:** Shared components, hooks, and business logic. |
| `public/` | **Assets:** Images, fonts, and static data. |
| `build/` | **Generated:** The native source code (WinUI/Android project files). |

---

## ✨ Why VaderNative?

* **Native Speed:** No heavy Virtual DOM; updates are sent directly to native views.
* **Single-File Windows Apps:** No complex installers; just one `.exe`.
* **Bun-First:** Leverages the fastest JS runtime for building and bundling.
* **Modern Tooling:** Tail logs, auto-patch `.csproj`, and hot-reload from one terminal. 